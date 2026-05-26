import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import { notificationService } from '../services/notificationService'

/**
 * Idempotent check: trả về true nếu chuyến đi này đã có notification cùng loại trong window vừa qua.
 * Tránh spam: cron chạy nhiều lần trong ngày sẽ không tạo trùng.
 */
async function alreadyNotified(tripId: string, type: string, withinHours: number): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 3_600_000)
  const existing = await prisma.notification.findFirst({
    where: { trip_id: tripId, type, created_at: { gte: since } },
    select: { notification_id: true },
  })
  return existing !== null
}

/**
 * Nhắc chuyến đi sắp bắt đầu (1 ngày trước start_date).
 * Chạy mỗi ngày 09:00 (Asia/Ho_Chi_Minh).
 */
async function remindUpcomingTrips(): Promise<void> {
  // Tính khoảng [ngày mai 00:00, ngày mai 23:59:59]
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  const dayAfter = new Date(tomorrow)
  dayAfter.setDate(dayAfter.getDate() + 1)

  const trips = await prisma.trip.findMany({
    where: {
      start_date: { gte: tomorrow, lt: dayAfter },
      status: { in: ['confirmed', 'draft', 'active'] },
      deleted_at: null,
    },
    select: { trip_id: true, user_id: true, title: true, destination_city: true },
  })

  for (const t of trips) {
    if (await alreadyNotified(t.trip_id, 'trip_starting_soon', 23)) continue
    await notificationService.create({
      userId: t.user_id,
      tripId: t.trip_id,
      type: 'trip_starting_soon',
      title: 'Chuyến đi sắp bắt đầu',
      message: `Chuyến đi "${t.title ?? t.destination_city}" của bạn bắt đầu vào ngày mai. Hãy kiểm tra lại lịch trình nhé!`,
      data: { startDate: tomorrow.toISOString().slice(0, 10) },
    })
  }

  if (trips.length > 0) {
    console.log(`[notificationCron] remindUpcomingTrips: scanned ${trips.length} trip(s)`)
  }
}

/**
 * Cảnh báo share link sắp hết hạn (trong vòng 24h).
 * Chạy mỗi giờ — chỉ tạo 1 notification cho mỗi share token (window 23h).
 */
async function warnExpiringShareLinks(): Promise<void> {
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 3_600_000)

  const trips = await prisma.trip.findMany({
    where: {
      share_token: { not: null },
      share_expires_at: { gt: now, lte: in24h },
      deleted_at: null,
    },
    select: { trip_id: true, user_id: true, title: true, destination_city: true, share_expires_at: true },
  })

  for (const t of trips) {
    if (await alreadyNotified(t.trip_id, 'share_expiring_soon', 23)) continue
    const hoursLeft = Math.max(1, Math.round(((t.share_expires_at!.getTime() - now.getTime()) / 3_600_000)))
    await notificationService.create({
      userId: t.user_id,
      tripId: t.trip_id,
      type: 'share_expiring_soon',
      title: 'Link chia sẻ sắp hết hạn',
      message: `Link chia sẻ chuyến đi "${t.title ?? t.destination_city}" sẽ hết hạn trong ~${hoursLeft} giờ. Vào lại để gia hạn nếu cần.`,
      data: { expiresAt: t.share_expires_at!.toISOString() },
    })
  }

  if (trips.length > 0) {
    console.log(`[notificationCron] warnExpiringShareLinks: scanned ${trips.length} trip(s)`)
  }
}

/**
 * Đăng ký cron jobs. Gọi 1 lần khi server start.
 */
export function startNotificationCron(): void {
  // Nhắc chuyến đi: 09:00 mỗi ngày
  cron.schedule(
    '0 9 * * *',
    () => {
      remindUpcomingTrips().catch((err) =>
        console.error('[notificationCron] remindUpcomingTrips failed:', err),
      )
    },
    { timezone: 'Asia/Ho_Chi_Minh' },
  )

  // Cảnh báo share hết hạn: mỗi giờ
  cron.schedule('0 * * * *', () => {
    warnExpiringShareLinks().catch((err) =>
      console.error('[notificationCron] warnExpiringShareLinks failed:', err),
    )
  })

  console.log('[notificationCron] scheduled: trip reminders @ 09:00 ICT, share expiry checks hourly')
}

// Export riêng để chạy tay khi cần (debug/test)
export const notificationJobs = {
  remindUpcomingTrips,
  warnExpiringShareLinks,
}
