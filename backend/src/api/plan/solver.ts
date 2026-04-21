import { Place, TripSlot, ObjectiveWeights } from '../../types'; // Nhớ import đúng type từ Người 2

// Hàm tính khoảng cách giả lập (nếu chưa có API Maps) - Tính bằng đường chim bay
function estimateTravelTimeMin(lat1: number, lng1: number, lat2: number, lng2: number): number {
    // Tạm thời trả về số random hoặc tính công thức Haversine
    // Giả sử tốc độ trung bình trong thành phố là 30km/h (tức là 1km đi mất 2 phút)
    const distanceKm = Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2)) * 111; 
    return Math.ceil(distanceKm * 2) + 5; // +5 phút hao phí kẹt xe/gửi xe
}

export function generateGreedyPlan(
    days: number,
    budgetTotal: number,
    candidates: Place[],
    weights: ObjectiveWeights,
    hotelPlace?: Place
): TripSlot[] {
    const plan: TripSlot[] = [];
    let budgetRemaining = budgetTotal;

    // Set để đánh dấu các POI đã đi — dùng string để tránh BigInt vs number mismatch
    const visitedPlaceIds = new Set<string>();

    for (let dayIndex = 0; dayIndex < days; dayIndex++) {
        // Giả sử bắt đầu ngày mới lúc 08:00 sáng
        let currentTimeMinutes = 8 * 60; // Tính theo phút từ 00:00
        const endOfDayMinutes = 20 * 60; // Kết thúc lúc 20:00 (8h tối)
        let slotOrder = 1;

        // Vị trí hiện tại: Bắt đầu từ Khách sạn, nếu không có KS thì lấy đại điểm đầu tiên làm tâm
        let currentLat = hotelPlace ? hotelPlace.lat : candidates[0]?.lat || 16.06;
        let currentLng = hotelPlace ? hotelPlace.lng : candidates[0]?.lng || 108.22;

        while (currentTimeMinutes < endOfDayMinutes) {
            let bestPlace: Place | null = null;
            let bestScore = -Infinity;
            let bestTravelTime = 0;

            // Quét tìm POI tốt nhất tiếp theo
            for (const place of candidates) {
                if (visitedPlaceIds.has(String(place.placeId))) continue;
                if (!place.lat || !place.lng) continue; // bỏ qua place thiếu tọa độ

                // 1. Kiểm tra các điều kiện (Ràng buộc cứng)
                const travelTime = estimateTravelTimeMin(currentLat, currentLng, place.lat, place.lng);
                const cost = place.avgVisitDurationMin || 0; // Giả sử cost nằm ở bảng giá
                const expectedArrival = currentTimeMinutes + travelTime;
                
                // Nếu đi đến nơi + thời gian chơi mà lố giờ kết thúc ngày -> Bỏ qua
                if (expectedArrival + place.avgVisitDurationMin > endOfDayMinutes) continue;
                
                // Nếu vượt ngân sách -> Bỏ qua
                // (Cần bổ sung logic check min_price/max_price tùy bạn định nghĩa)
                
                // 2. Chấm điểm (Ràng buộc mềm - Áp dụng ObjectiveWeights)
                // Theo công thức: wInterest * tagMatch - wDistance * travelTime...
                // (Bạn cần có hàm tính tagMatch ở đây giống như trong file handlers.ts của bạn)
                const interestScore = 10; // Chỗ này bạn ráp code tính điểm sở thích vào nhé
                const distancePenalty = travelTime * weights.wDistance;
                
                const currentScore = (weights.wInterest * interestScore) - distancePenalty; // Trừ điểm nếu đi xa

                if (currentScore > bestScore) {
                    bestScore = currentScore;
                    bestPlace = place;
                    bestTravelTime = travelTime;
                }
            }

            // Nếu không tìm được POI nào phù hợp nữa -> Kết thúc ngày, về đi ngủ
            if (!bestPlace) {
                break;
            }

            // 3. Nhét POI vào lịch
            const startTime = new Date();
            startTime.setHours(Math.floor((currentTimeMinutes + bestTravelTime) / 60), (currentTimeMinutes + bestTravelTime) % 60, 0, 0);
            
            const endTime = new Date(startTime);
            // DÙNG FALLBACK: Nếu DB null, cho mặc định chơi 60 phút
            const duration = bestPlace.avgVisitDurationMin || 60; 
            endTime.setMinutes(endTime.getMinutes() + duration);

            plan.push({
                slotId: `slot_${dayIndex}_${slotOrder}`,
                tripId: 'temp_trip',
                dayIndex: dayIndex,
                slotOrder: slotOrder,
                version: 1,
                placeId: bestPlace.placeId,
                plannedStart: startTime.toISOString(),
                plannedEnd: endTime.toISOString(),
                actualStart: null,
                actualEnd: null,
                estimatedCost: bestPlace.minPrice || 0,
                activityType: 'sightseeing',
                rationale: `Điểm số: ${bestScore}`,
                status: 'planned'
            });

            // 4. Cập nhật lại Trạng thái (State) cho vòng lặp tiếp theo
            visitedPlaceIds.add(String(bestPlace.placeId));
            currentTimeMinutes += bestTravelTime + duration;
            currentLat = bestPlace.lat ?? currentLat;
            currentLng = bestPlace.lng ?? currentLng;
            budgetRemaining -= (bestPlace.minPrice || 0);
            slotOrder++;
        }
    }

    return plan;
}

// backend/src/api/plan/solver.ts

// 1. Định nghĩa các kiểu dữ liệu cơ bản (Giả định theo mô hình của bạn)
// --- DÁN ĐOẠN NÀY XUỐNG CUỐI FILE solver.ts CỦA BẠN ---

// Hàm tính khoảng cách giữa 2 tọa độ (Công thức Haversine)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Bán kính trái đất (km)
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Trả về Kilomet
}

// Hàm tìm thông tin Place đầy đủ dựa trên placeId
function getPlaceDetails(placeId: number, candidates: Place[]): Place | undefined {
    return candidates.find(p => p.placeId === placeId);
}

// Hàm chấm điểm đã được sửa để nhận data thật của team
export function calculateItineraryScore(
    slots: TripSlot[], 
    prefs: any, // Tạm dùng any cho UserPreferences để tránh lỗi type
    candidates: Place[] // Cần danh sách gốc để tra cứu tọa độ/giá tiền
): number {
  let totalScore = 0;
  let currentBudget = prefs.budgetRemaining;

  for (let i = 0; i < slots.length; i++) {
    // 1. Tìm thông tin chi tiết của địa điểm dựa trên placeId trong slot
    const currentPlace = getPlaceDetails(slots[i].placeId, candidates);
    if (!currentPlace) continue; // Bỏ qua nếu lỗi không tìm thấy

    let slotScore = 0;

    // A. Điểm sở thích (Tạm thời cho 10 điểm mỗi POI vì data tag hiện tại hơi phức tạp)
    slotScore += prefs.weights.interest * 10; 

    // B. Điểm khoảng cách (Distance Penalty)
    if (i > 0) {
      const prevPlace = getPlaceDetails(slots[i - 1].placeId, candidates);
      if (prevPlace) {
         const distance = calculateDistance(prevPlace.lat, prevPlace.lng, currentPlace.lat, currentPlace.lng);
         slotScore -= prefs.weights.distance * distance; 
      }
    }

    // C. Điểm ngân sách (Budget)
    currentBudget -= currentPlace.minPrice || 0;
    if (currentBudget < 0) {
      slotScore -= prefs.weights.budget * 50; 
    }

    // D. Điểm thời tiết (Tạm thời bỏ qua phần isOutdoor vì Interface Place chưa có)
    slotScore += prefs.weights.weather * 5; 

    totalScore += slotScore;
  }

  return totalScore;
}

export function optimizeWith2Opt(
    initialSlots: TripSlot[], 
    prefs: any, 
    candidates: Place[]
): TripSlot[] {
  let bestSlots = [...initialSlots];
  let bestScore = calculateItineraryScore(bestSlots, prefs, candidates);
  let improved = true;
  let iterations = 0;
  const MAX_ITERATIONS = 50; 

  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;

    for (let i = 1; i < bestSlots.length - 1; i++) {
      for (let j = i + 1; j < bestSlots.length; j++) {
        
        const newSlots = [
          ...bestSlots.slice(0, i),
          ...bestSlots.slice(i, j + 1).reverse(),
          ...bestSlots.slice(j + 1)
        ];

        const newScore = calculateItineraryScore(newSlots, prefs, candidates);

        if (newScore > bestScore) {
          bestSlots = newSlots;
          bestScore = newScore;
          improved = true; 
        }
      }
    }
  }

  console.log(`[2-Opt] Hoàn thành sau ${iterations} vòng. Điểm tổng: ${bestScore}`);
  return bestSlots;
}