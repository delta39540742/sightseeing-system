import os
import re

sql_file = os.path.join(os.path.dirname(__file__), '..', 'data', 'seed_tien_ich_cong_cong.sql')

with open(sql_file, 'r', encoding='utf-8') as f:
    sql = f.read()

def transform_line(line):
    if not line.startswith('INSERT'): 
        return line
        
    # Pattern to match the existing SQL:
    # VALUES ('osm_...', 'NAME_HERE', 'TYPE', LON, LAT)
    match = re.search(r"VALUES \('([^']+)', '([^']+)', '([^']+)', ([0-9.]+), ([0-9.]+)\)", line)
    if not match: 
        return line
        
    pk_id, ten, loai, lon, lat = match.groups()
    
    # Logic 1: Remove address (anything starting from ' - ')
    if ' - ' in ten:
        ten = ten.split(' - ')[0].strip()
    
    # Logic 2: If the name is just a generic fallback, replace with NULL
    generic_names = [
        'ATM', 
        'Trạm xăng', 
        'Bãi đỗ xe', 'Bãi đỗ xe ngầm', 'Bãi đỗ xe nhiều tầng', 'Bãi đỗ xe tầng thượng', 
        'Nhà vệ sinh công cộng', 'Nhà vệ sinh (dành cho khách)',
        'Nhà vệ sinh'
    ]
    
    if ten in generic_names:
        ten_sql = "NULL"
    else:
        # Prevent SQL injection issues or nested escapes by replacing raw ' just in case,
        # Though our original code used '' to escape.
        ten_escaped = ten.replace("'", "''")
        ten_sql = f"'{ten_escaped}'"
        
    # Replace the old VALUES(...) segment with the new one
    new_values = f"VALUES ('{pk_id}', {ten_sql}, '{loai}', {lon}, {lat})"
    return re.sub(r"VALUES \([^)]+\)", new_values, line)

lines = sql.split('\n')
new_lines = [transform_line(l) for l in lines]

with open(sql_file, 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

print("Đã apply thay đổi trực tiếp lên seed_tien_ich_cong_cong.sql!")
