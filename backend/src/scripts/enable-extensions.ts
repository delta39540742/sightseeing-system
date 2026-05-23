import 'dotenv/config'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function main() {
  const client = await pool.connect()
  try {
    console.log('[Extensions] Connecting to database...')
    
    console.log('[Extensions] Creating "unaccent" extension...')
    await client.query('CREATE EXTENSION IF NOT EXISTS unaccent;')
    
    console.log('[Extensions] Creating "pg_trgm" extension...')
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
    
    console.log('[Extensions] Successfully enabled both extensions!')
  } catch (err) {
    console.error('[Extensions] Error enabling extensions:', err)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error('[Extensions] Critical failure:', err)
  process.exit(1)
})
