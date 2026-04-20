import requests
import json
import time
import os
import sys

# Configure stdout to handle UTF-8 for Windows consoles
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Cấu hình Overpass API
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# Bbox toàn bộ TP.HCM (Từ Củ Chi đến Cần Giờ)
BBOX = "10.350,106.350,11.200,107.050"

# Lấy các tiện ích công cộng: atm, nhà vệ sinh, bãi đỗ xe, trạm xăng
QUERY = f"""
[out:json][timeout:300];
(
  node["amenity"~"atm|toilets|parking|fuel"]({BBOX});
  way["amenity"~"atm|toilets|parking|fuel"]({BBOX});
  relation["amenity"~"atm|toilets|parking|fuel"]({BBOX});
);
out center;
"""

MAX_RETRIES = 3
SQL_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'seed_tien_ich_cong_cong.sql')

CACHE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw_amenities.json')

def fetch_data_with_retry():
    # Thử gọi API
    for attempt in range(MAX_RETRIES):
        print(f"Đang tải dữ liệu từ Overpass API... (Lần thử {attempt + 1}/{MAX_RETRIES})")
        try:
            response = requests.post(OVERPASS_URL, data={'data': QUERY}, timeout=300)
            if response.status_code == 200:
                print("Tải dữ liệu thành công từ API!")
                data = response.json()
                # Lưu cache
                os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
                with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                return data
            else:
                print(f"Lỗi {response.status_code}: Lỗi từ Server")
        except Exception as e:
            print(f"Exception: Lỗi kết nối")
        
        print("Chờ 5 giây trước khi thử lại...")
        time.sleep(5)
    
    # Rơi vào fallback: Đọc từ cache
    print("Thất bại khi gọi API. Thử đọc dữ liệu từ cache cục bộ...")
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            print("Đã lấy thành công từ cache!")
            return data
            
    print("Thiếu dữ liệu cache luôn :(")
    return None

def build_specific_name(tags):
    """
    Lấy tên từ OSM tags theo thứ tự ưu tiên: name > brand > operator.
    Nếu không có gì → trả về None (không đặt tên mặc định).
    """
    return (
        tags.get('name', '').strip() or
        tags.get('brand', '').strip() or
        tags.get('operator', '').strip() or
        None
    )


def generate_sql(data):
    if not data or 'elements' not in data:
        return

    elements = data['elements']
    print(f"Đã lấy được {len(elements)} phần tử từ API.")

    # Thống kê phân loại
    stats = {'atm': 0, 'toilets': 0, 'parking': 0, 'fuel': 0, 'skipped': 0}

    # Tạo nội dung SQL
    sql_lines = [
        "-- =====================================================================",
        "-- SEED DATA: TIỆN ÍCH CÔNG CỘNG (ATM, NHÀ VỆ SINH, BÃI ĐỖ XE, TRẠM XĂNG)",
        "-- Phạm vi: Toàn bộ Thành phố Hồ Chí Minh",
        "-- Dành cho module AI (PostGIS) tính toán ngữ cảnh",
        "-- =====================================================================",
        "",
        "CREATE TABLE IF NOT EXISTS tien_ich_cong_cong (",
        "    id VARCHAR(100) PRIMARY KEY,",
        "    ten VARCHAR(255),",
        "    loai_tien_ich VARCHAR(50),",
        "    kinh_do DECIMAL(10, 7),",
        "    vi_do DECIMAL(10, 7),",
        "    thoi_diem_ghi_nhan TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        ");",
        "",
        "-- Xóa dữ liệu cũ nếu chạy lại script",
        "TRUNCATE TABLE tien_ich_cong_cong;",
        ""
    ]

    insert_count = 0
    for el in elements:
        if 'tags' not in el or 'amenity' not in el['tags']:
            stats['skipped'] += 1
            continue

        el_type = el['type']
        el_id = el['id']
        pk_id = f"osm_{el_type}_{el_id}"

        amenity_type = el['tags']['amenity']
        if amenity_type not in ['atm', 'toilets', 'parking', 'fuel']:
            stats['skipped'] += 1
            continue

        # Xây tên cụ thể: name > brand > operator, hoặc NULL nếu không có
        name = build_specific_name(el['tags'])

        # Tọa độ
        lat = el.get('lat') or (el.get('center') and el['center'].get('lat'))
        lon = el.get('lon') or (el.get('center') and el['center'].get('lon'))

        if lat is None or lon is None:
            stats['skipped'] += 1
            continue

        # Render giá trị ten thành SQL: chuỗi có escape hoặc NULL
        ten_sql = f"'{name.replace(chr(39), chr(39)*2)}'" if name else "NULL"

        sql = (
            f"INSERT INTO tien_ich_cong_cong (id, ten, loai_tien_ich, kinh_do, vi_do) "
            f"VALUES ('{pk_id}', {ten_sql}, '{amenity_type}', {lon}, {lat}) "
            f"ON CONFLICT (id) DO NOTHING;"
        )
        sql_lines.append(sql)
        stats[amenity_type] += 1
        insert_count += 1

    # Lưu file
    os.makedirs(os.path.dirname(os.path.abspath(SQL_FILE_PATH)), exist_ok=True)
    with open(SQL_FILE_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sql_lines))

    print(f"\nĐã tạo file SQL: {SQL_FILE_PATH}")
    print(f"Tổng số INSERT: {insert_count}")
    print(f"  ATM          : {stats['atm']}")
    print(f"  Trạm xăng    : {stats['fuel']}")
    print(f"  Bãi đỗ xe    : {stats['parking']}")
    print(f"  Nhà vệ sinh  : {stats['toilets']}")
    print(f"  Bỏ qua       : {stats['skipped']}")


if __name__ == "__main__":
    try:
        import requests  # noqa: F811
    except ImportError:
        print("Vui lòng cài đặt requests: pip install requests")
        sys.exit(1)

    data = fetch_data_with_retry()
    if data:
        generate_sql(data)

