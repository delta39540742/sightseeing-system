import 'dotenv/config';
import axios from 'axios';

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/tỉnh|thành phố/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function query(q: string, label: string): Promise<any[]> {
  for (let i = 0; i < OVERPASS_URLS.length; i++) {
    const url = OVERPASS_URLS[i];
    try {
      const r = await axios.post(url, `data=${encodeURIComponent(q)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TravelSystemDiag/1.0' },
        timeout: 90000,
      });
      return r.data?.elements || [];
    } catch (e: any) {
      console.error(`[${label}] ${url} -> ${e?.response?.status || e?.code}`);
      await sleep(5000);
    }
  }
  return [];
}

async function main() {
  console.log('\n=== admin_level=4 ===');
  const lvl4 = await query(`
    [out:json][timeout:60];
    area["ISO3166-1"="VN"]["admin_level"="2"]->.vn;
    relation["boundary"="administrative"]["admin_level"="4"](area.vn);
    out tags;
  `, 'lvl4');
  for (const el of lvl4) {
    if (!el.tags?.name) continue;
    console.log(`  ${slugify(el.tags.name).padEnd(28)} | id=${el.id} | name="${el.tags.name}"`);
  }
  console.log(`Total lvl4: ${lvl4.length}`);

  await sleep(3000);

  console.log('\n=== admin_level=5 (post-2025 sub-units?) ===');
  const lvl5 = await query(`
    [out:json][timeout:60];
    area["ISO3166-1"="VN"]["admin_level"="2"]->.vn;
    relation["boundary"="administrative"]["admin_level"="5"](area.vn);
    out tags;
  `, 'lvl5');
  for (const el of lvl5) {
    if (!el.tags?.name) continue;
    console.log(`  ${slugify(el.tags.name).padEnd(28)} | id=${el.id} | name="${el.tags.name}"`);
  }
  console.log(`Total lvl5: ${lvl5.length}`);

  await sleep(3000);

  console.log('\n=== admin_level=6 (old province names retained as districts?) ===');
  const lvl6 = await query(`
    [out:json][timeout:60];
    area["ISO3166-1"="VN"]["admin_level"="2"]->.vn;
    relation["boundary"="administrative"]["admin_level"="6"](area.vn);
    out tags;
  `, 'lvl6');
  let l6Count = 0;
  for (const el of lvl6) {
    if (!el.tags?.name) continue;
    l6Count++;
  }
  console.log(`Total lvl6 with name: ${l6Count} (showing first 30)`);
  for (const el of lvl6.slice(0, 30)) {
    if (!el.tags?.name) continue;
    console.log(`  ${slugify(el.tags.name).padEnd(28)} | id=${el.id} | name="${el.tags.name}"`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
