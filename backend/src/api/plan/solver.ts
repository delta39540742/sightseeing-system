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
    
    // Set để đánh dấu các POI đã đi, tránh lặp lại
    const visitedPlaceIds = new Set<number>();

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
                if (visitedPlaceIds.has(place.placeId)) continue;
                
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
            endTime.setMinutes(endTime.getMinutes() + bestPlace.avgVisitDurationMin);

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
            visitedPlaceIds.add(bestPlace.placeId);
            currentTimeMinutes += bestTravelTime + bestPlace.avgVisitDurationMin;
            currentLat = bestPlace.lat;
            currentLng = bestPlace.lng;
            budgetRemaining -= (bestPlace.minPrice || 0);
            slotOrder++;
        }
    }

    return plan;
}