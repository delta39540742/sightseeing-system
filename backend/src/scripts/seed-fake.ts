import 'dotenv/config'
import { prisma } from '../lib/prisma'
import { randomUUID } from 'crypto'


const NUM_USERS = 50
const TRIPS_PER_USER = 15

async function main() {
  console.log('[SEED-FAKE] Start seeding...')

  // lấy sẵn list place để gán random
  const places = await prisma.place.findMany({
    select: { place_id: true },
  })

  if (places.length === 0) {
    throw new Error('No places found. Run seed:places first.')
  }

  //  tạo users
  const users = []

  for (let i = 0; i < NUM_USERS; i++) {
    users.push({
      user_id: randomUUID(),
      firebase_uid: `fake_user_${i}`,
      email: `user${i}@test.com`,
      display_name: `User ${i}`,
    })
  }

  await prisma.app_user.createMany({
    data: users,
    skipDuplicates: true,
  })

  console.log(`[SEED-FAKE] Inserted ${users.length} users`)

  //  tạo trips
  let tripCount = 0

  for (const user of users) {
    for (let i = 0; i < TRIPS_PER_USER; i++) {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() + i)

      const endDate = new Date(startDate)
      endDate.setDate(startDate.getDate() + 2)

      await prisma.trip.create({
        data: {
          trip_id: randomUUID(),
          user_id: user.user_id,
          destination_city: 'Da Nang',
          start_date: startDate,
          end_date: endDate,
          budget_total: Math.floor(Math.random() * 3000000) + 2000000,
          status: 'draft',
        },
      })

      tripCount++
    }
  }

  console.log(`[SEED-FAKE] Inserted ${tripCount} trips`)
  console.log('[SEED-FAKE] DONE ')
}

main()
  .catch((e) => {
    console.error('[SEED-FAKE] ERROR:', e)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })