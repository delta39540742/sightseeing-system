import fs from 'fs';
import path from 'path';

const dataDir = path.resolve(__dirname, '../../../data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

let totalBefore = 0;
let totalAfter = 0;

for (const file of files) {
  const fp = path.join(dataDir, file);
  const records: any[] = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  totalBefore += records.length;

  const seen = new Set<string>();
  const kept: any[] = [];
  let dropped = 0;
  for (const r of records) {
    if (typeof r.name !== 'string' || typeof r.lat !== 'number' || typeof r.lng !== 'number') {
      kept.push(r);
      continue;
    }
    const key = `${r.name}|${r.lat.toFixed(6)}|${r.lng.toFixed(6)}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    kept.push(r);
  }

  totalAfter += kept.length;

  if (dropped > 0) {
    fs.writeFileSync(fp, JSON.stringify(kept, null, 2), 'utf-8');
    console.log(`  ${file}: ${records.length} -> ${kept.length} (dropped ${dropped})`);
  }
}

console.log(`\nTotal: ${totalBefore} -> ${totalAfter} (dropped ${totalBefore - totalAfter})`);
