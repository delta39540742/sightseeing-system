import type { Trip, TripSlot, TripState, Place, UserPreference } from '@app/types';

/**
 * PlanLoader
 *
 * Chịu trách nhiệm tải và hydrate dữ liệu chuyến đi từ database.
 * Nhận trip_id, truy vấn Postgres để lấy Trip + TripSlot[] + Place[] liên quan,
 * tổng hợp thành TripState đầy đủ sẵn sàng cho pipeline replanning.
 *
 * Nhiệm vụ chính:
 *  - Kết nối Pool (node-postgres) và thực hiện các truy vấn song song
 *  - Deserialize JSON columns (constraints, preferences) từ DB row
 *  - Validate tính hợp lệ của dữ liệu trước khi trả về
 *  - Cung cấp UserPreference để các module sau dùng khi tính objective
 */
export class PlanLoader {
  /**
   * Tải TripState đầy đủ từ database theo trip_id.
   * @param tripId UUID của chuyến đi cần tải
   * @returns Promise<TripState> trạng thái hiện tại của chuyến đi
   */
  async load(tripId: string): Promise<TripState> {
    throw new Error('Not implemented');
  }

  /**
   * Tải UserPreference của owner chuyến đi.
   * @param userId UUID của người dùng
   */
  async loadPreferences(userId: string): Promise<UserPreference> {
    throw new Error('Not implemented');
  }
}
