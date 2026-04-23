import { randomUUID } from 'crypto';

export const LANDMARK_MAP: Record<number, { name: string; pattern: RegExp; placeId: number }> = {
  1:  { name: "Cầu Rồng",        pattern: /cau\.rong/i,   placeId: 101 },
  2:  { name: "Bà Nà Hills",     pattern: /ba\.na/i,      placeId: 102 },
  3:  { name: "Ngũ Hành Sơn",   pattern: /ngu\.hanh/i,   placeId: 103 },
  4:  { name: "Chợ Cồn",        pattern: /cho\.con/i,    placeId: 104 },
  5:  { name: "Linh Ứng",       pattern: /linh\.ung/i,   placeId: 105 },
  6:  { name: "Cầu Vàng",       pattern: /cau\.vang/i,   placeId: 106 },
  7:  { name: "Mỹ Khê",         pattern: /my\.khe/i,     placeId: 107 },
  8:  { name: "Hải Vân",        pattern: /hai\.van/i,    placeId: 108 },
  9:  { name: "Bảo tàng Chăm",  pattern: /cham/i,        placeId: 109 },
  10: { name: "Sơn Trà",        pattern: /son\.tra/i,    placeId: 110 },
};

// recognitionId -> placeId
export const recognitionStore = new Map<string, number>();

export function mockIdentify(filename: string) {
  const entry = Object.entries(LANDMARK_MAP).find(([_, val]) => val.pattern.test(filename));
  if (!entry) return null;

  const [classId, data] = entry;
  const recognitionId = randomUUID();
  recognitionStore.set(recognitionId, data.placeId);

  return {
    recognitionId,
    classId: parseInt(classId),
    placeId: data.placeId,
    place: {
      id: data.placeId,
      name: data.name,
      address: 'Đà Nẵng, Việt Nam',
      rating: 4.8,
    },
  };
}
