import { api } from './api'

export interface TrendingDestination {
  id: number
  name: string
  region: 'bac' | 'trung' | 'nam'
  province: string
  description: string
  imageUrl: string
  tags: string[]
  rating: number
  trendingScore: number
  visitCountThisWeek: number
  trendingReason: string
}

// ---------------------------------------------------------------------------
// Mock — dùng khi backend chưa có endpoint GET /api/places/trending
// ---------------------------------------------------------------------------
const MOCK_TRENDING: TrendingDestination[] = [
  {
    id: 1,
    name: 'Vịnh Hạ Long',
    region: 'bac',
    province: 'Quảng Ninh',
    description: 'Kỳ quan thiên nhiên thế giới với hàng nghìn đảo đá vôi kỳ vĩ vươn lên từ làn nước xanh ngọc bích.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA_MiHf3tXxadAdvXOW5sxH3HIvM4VV-k1hEYLtozGQyFSmIfBbdmPX0-UUraGO7a5Yn1jo0-4UFz2bQKV5oFFM5aSkn4ycmzAci9IwrXCpZLOeXd5HFpFHFC2TdtiQmf42BdUkvf9d00FYinqthBb_pbTX85gEElmvhgel8jT3g7Npcbl4tJviXzcYNrBjDOj9LQgrDs8qD1dZIiRLWbQA_b537WQVu6NPv_Voje1fr-Z_H2jDylUWohaF-lkPeZwbDlmPTzNeb4k',
    tags: ['Di sản UNESCO', 'Biển đảo', 'Thiên nhiên'],
    rating: 4.9,
    trendingScore: 98,
    visitCountThisWeek: 14200,
    trendingReason: 'Mùa hè cao điểm — lượng booking tăng 32% so với tuần trước',
  },
  {
    id: 2,
    name: 'Phố cổ Hội An',
    region: 'trung',
    province: 'Quảng Nam',
    description: 'Đô thị cảng cổ đại được bảo tồn nguyên vẹn với kiến trúc Á Đông hòa quyện ánh đèn lồng lung linh.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBpQe4tigI4nF7cfh1bd0mgPicRauuhRGXhFcOciefTgV9FTCm5ahnpqiYs74mI2ILw4T5x5hxE0PMSih4iwK-T7sZpE1y8YWDTr463PQ1_i8EvtY8B8yJsrVHQo6pEpX8_o2uazzYSyeHaktkHkF9wJ7YzVZ-W2APv09D4oaPqMc0mcPbkcVpzSREMzyBMc0UveRcKgS0VwGR8RSjNIhWjd2poFQ3KsHrToVo7-pxsBuTlaiYzbHqylSzjFmQ2209Bu_x62aLHX18',
    tags: ['Di sản UNESCO', 'Phố cổ', 'Ẩm thực'],
    rating: 4.9,
    trendingScore: 95,
    visitCountThisWeek: 11800,
    trendingReason: 'Đêm rằm Hội An tháng này thu hút lượng khách kỷ lục',
  },
  {
    id: 3,
    name: 'Đà Nẵng',
    region: 'trung',
    province: 'Đà Nẵng',
    description: 'Thành phố năng động bên biển với Cầu Rồng biểu tượng, bãi biển Mỹ Khê trải dài và ẩm thực đường phố phong phú.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAGKOaVfXOpqS_ebQpgsplVmH6bsVqoDUAZtuOmobDk6lL7iX-qkILpQdO2B0xZgi4txJWiv67yzxGNdFN4kATSdsrp3mWmrcLikiLolqqiVhd124zDUaN8-pcmH1MRaV2nWkZN0FVHvHLmQFh5bgxV83jJsez6R_zpn_XoGVmvc2HViUMhO31ZxNkWBckfyjgDi8r53XaRPLNLPqB6e5s_Y5nNyfP9E9kWIYmaG6hXrrG3OnOCf-iNyUM4EZrB5HZYJURcjbxtyHE',
    tags: ['Bãi biển', 'Thành phố', 'Ẩm thực'],
    rating: 4.7,
    trendingScore: 91,
    visitCountThisWeek: 9600,
    trendingReason: 'Top điểm đến hè 2026 theo lượt tìm kiếm tuần này',
  },
  {
    id: 4,
    name: 'Phú Quốc',
    region: 'nam',
    province: 'Kiên Giang',
    description: 'Đảo ngọc thiên đường với bãi biển cát trắng mịn, nước biển trong xanh và hệ sinh thái rừng nhiệt đới đa dạng.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB4iyn5dlKlOavsVjzi6rzFdpXyuPCHx0ga6sXtveKjW2DSANqDpplnxfiymhLBukfoJNnVZmr2HKprGNepsQpiBsNPWKMSzXLOtCmvBpJploBHSvnIXF6GvyZFngOnyhmAKYVuwlhJiSHJahEgbnil2byMpfgzk5kiqqlpxcpThb4UMuE2Fmsg622qsiy43oqVjrvlU6vjRJQmshaDn1dEf3ZsdUvs1vRDU5gyn9ogdoZUs2ZOzM-SDUvj44qV5YKpWB1vpiuXRPc',
    tags: ['Biển đảo', 'Resort', 'Lặn biển'],
    rating: 4.8,
    trendingScore: 89,
    visitCountThisWeek: 8900,
    trendingReason: 'Đường bay thẳng mới khai thác — lượt đặt vé tăng 45%',
  },
  {
    id: 5,
    name: 'Sa Pa',
    region: 'bac',
    province: 'Lào Cai',
    description: 'Thị trấn sương mù trên đỉnh núi với ruộng bậc thang kỳ vĩ, văn hóa dân tộc đặc sắc và đỉnh Fansipan hùng vĩ.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDxXIie7LQ-372AUk50Qjp8vVUxXAqW_WSgsWnhJFSzBysT4fOrfMKy-AyceuXCcIh9jUdjd57FIH0o7abWaL2TeGMCvI5gyj7faWzJeJNmbCksUsRoPSx5TIczaIpr8kvMlaadOUTcNrRCuv7gxHWEbRwHHY7uX0dpkot8XW3oGVnZAkg7vnYSlMO8rtmRdQsYiZUCW9Oak1NFyTXchNNnBZDqObozsOIFPMq5AFLi6WOkzn3T2uVWbNDJ5HxkZpFqMWMYdJbuu98',
    tags: ['Núi cao', 'Trekking', 'Văn hóa dân tộc'],
    rating: 4.8,
    trendingScore: 87,
    visitCountThisWeek: 7400,
    trendingReason: 'Mùa lúa chín vàng — ảnh check-in lan truyền mạnh trên mạng xã hội',
  },
  {
    id: 6,
    name: 'Ninh Bình',
    region: 'bac',
    province: 'Ninh Bình',
    description: 'Vịnh Hạ Long trên cạn với những cánh đồng lúa, núi đá vôi và dòng sông lặng lờ tạo nên bức tranh thiên nhiên thơ mộng.',
    imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&auto=format&fit=crop',
    tags: ['Thiên nhiên', 'Chùa chiền', 'Thuyền độc mộc'],
    rating: 4.7,
    trendingScore: 84,
    visitCountThisWeek: 6800,
    trendingReason: 'Cố đô Hoa Lư vừa được UNESCO công nhận thêm giá trị',
  },
  {
    id: 7,
    name: 'Mũi Né',
    region: 'nam',
    province: 'Bình Thuận',
    description: 'Thiên đường lướt ván diều với đồi cát vàng hùng vĩ, suối Tiên đa sắc màu và các khu resort sang trọng ven biển.',
    imageUrl: 'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&auto=format&fit=crop',
    tags: ['Bãi biển', 'Đồi cát', 'Lướt ván'],
    rating: 4.5,
    trendingScore: 80,
    visitCountThisWeek: 5200,
    trendingReason: 'Giải lướt ván diều quốc tế đang diễn ra thu hút nhiều du khách',
  },
  {
    id: 8,
    name: 'Đà Lạt',
    region: 'nam',
    province: 'Lâm Đồng',
    description: 'Thành phố ngàn hoa giữa cao nguyên mát lạnh quanh năm với kiến trúc biệt thự Pháp cổ và những vườn dâu tây bạt ngàn.',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBb4uVTQ1k7x7ZVLWGT2Fojbu-Xi1Ksc3vT5O7JuRelOuiOZRK2sHvJxtswyNYKsTgr_lTA6dpVfr3RcJq1NyAnIoOahbvC2Yh5L3pEdMsvpd6_ne9kcoHTKYJitnDv_V8Bl-oxMQK039B9q2LPBWCN7Kqs46-iTrS79iv80K6315hBIZ25f5np_ypvzqpr5w7vUzofnZNICoAGpOfLqMqndkoXlBfMOq6t1PDYAiEcdHoU6MyXIsmVODCg4mldytIghtb90m7Nujw',
    tags: ['Hoa', 'Cà phê', 'Khí hậu mát'],
    rating: 4.7,
    trendingScore: 78,
    visitCountThisWeek: 5100,
    trendingReason: 'Festival Hoa Đà Lạt sắp khai mạc — khách đặt phòng sớm tăng vọt',
  },
  {
    id: 9,
    name: 'Cần Thơ',
    region: 'nam',
    province: 'Cần Thơ',
    description: 'Thủ phủ miền Tây sông nước với chợ nổi Cái Răng độc đáo, vườn cây ăn trái bạt ngàn và ẩm thực dân dã đặc trưng.',
    imageUrl: 'https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=800&auto=format&fit=crop',
    tags: ['Chợ nổi', 'Miền Tây', 'Ẩm thực'],
    rating: 4.5,
    trendingScore: 72,
    visitCountThisWeek: 4300,
    trendingReason: 'Mùa nước nổi — cảnh quan đẹp nhất trong năm',
  },
  {
    id: 10,
    name: 'Quy Nhơn',
    region: 'trung',
    province: 'Bình Định',
    description: 'Viên ngọc thô của miền Trung với những bãi biển còn hoang sơ, tháp Chăm cổ kính và hải sản tươi ngon bậc nhất.',
    imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop',
    tags: ['Biển hoang sơ', 'Tháp Chăm', 'Hải sản'],
    rating: 4.6,
    trendingScore: 68,
    visitCountThisWeek: 3800,
    trendingReason: 'Điểm đến mới nổi 2026 — được Lonely Planet đề xuất',
  },
  {
    id: 11,
    name: 'Hà Giang',
    region: 'bac',
    province: 'Hà Giang',
    description: 'Cực Bắc Tổ quốc với cao nguyên đá Đồng Văn hùng vĩ, Mã Pì Lèng choáng ngợp và nét văn hóa dân tộc H\'Mông độc đáo.',
    imageUrl: 'https://images.unsplash.com/photo-1516690561799-46d8f74f9abf?w=800&auto=format&fit=crop',
    tags: ['Trekking', 'Văn hóa H\'Mông', 'Địa chất'],
    rating: 4.9,
    trendingScore: 65,
    visitCountThisWeek: 3200,
    trendingReason: 'Mùa hoa tam giác mạch nở rộ thu hút hàng ngàn nhiếp ảnh gia',
  },
  {
    id: 12,
    name: 'Côn Đảo',
    region: 'nam',
    province: 'Bà Rịa - Vũng Tàu',
    description: 'Quần đảo thiên nhiên hoang dã với bãi biển trong vắt, rùa biển đẻ trứng và di tích lịch sử nhà tù Côn Đảo nổi tiếng.',
    imageUrl: 'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800&auto=format&fit=crop',
    tags: ['Đảo hoang sơ', 'Lặn biển', 'Di tích lịch sử'],
    rating: 4.8,
    trendingScore: 61,
    visitCountThisWeek: 2900,
    trendingReason: 'Mùa rùa biển đẻ trứng — trải nghiệm sinh thái quý hiếm',
  },
]

export const destinationService = {
  /**
   * Lấy danh sách điểm đến đang hot/trending.
   * Khi backend triển khai GET /api/places/trending, hàm này sẽ tự động dùng API thật.
   * API trả về: { places: TrendingDestination[], updatedAt: string }
   */
  getTrending: async (limit = 12): Promise<TrendingDestination[]> => {
    try {
      const res = await api.get<{ places: TrendingDestination[]; updatedAt: string }>(
        '/places/trending',
        { params: { limit } },
      )
      return res.data.places
    } catch {
      // Backend chưa có endpoint này → dùng mock
      return MOCK_TRENDING.slice(0, limit)
    }
  },

  /**
   * Lấy điểm đến theo vùng miền.
   * Backend: GET /api/places/trending?region=bac|trung|nam
   */
  getTrendingByRegion: async (region: 'bac' | 'trung' | 'nam', limit = 6): Promise<TrendingDestination[]> => {
    try {
      const res = await api.get<{ places: TrendingDestination[] }>(
        '/places/trending',
        { params: { region, limit } },
      )
      return res.data.places
    } catch {
      return MOCK_TRENDING.filter((d) => d.region === region).slice(0, limit)
    }
  },
}
