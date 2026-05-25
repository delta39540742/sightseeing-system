import fs from 'fs';
import path from 'path';

// Vietnam rough bounding box (with margin for islands)
const VN_LAT = { min: 6.0, max: 24.0 };
const VN_LNG = { min: 101.5, max: 110.5 };

const ALLOWED_CATEGORIES = new Set(['attraction', 'restaurant', 'cafe', 'other']);
const TIME_RE = /^\d{2}:\d{2}$/;

interface PlaceRecord {
  id?: string;
  name?: string;
  lat?: number;
  lng?: number;
  category?: string;
  tags?: string[];
  price_min?: number;
  price_max?: number;
  visit_cost?: number;
  opening_hours?: { open?: string; close?: string };
  duration_minutes?: number;
  is_indoor?: boolean;
  popularity?: number;
  rating?: number;
  image?: string;
  address?: string;
  province?: string;
  province_slug?: string;
}

interface Issue {
  file: string;
  index: number;
  id?: string;
  name?: string;
  problem: string;
}

function validateRecord(p: PlaceRecord, file: string, index: number): Issue[] {
  const issues: Issue[] = [];
  const tag = (problem: string) => issues.push({ file, index, id: p.id, name: p.name, problem });

  if (typeof p.id !== 'string' || !p.id) tag('missing/invalid id');
  if (typeof p.name !== 'string' || !p.name.trim()) tag('missing/empty name');

  if (typeof p.lat !== 'number' || !Number.isFinite(p.lat)) {
    tag(`bad lat: ${p.lat}`);
  } else if (p.lat < VN_LAT.min || p.lat > VN_LAT.max) {
    tag(`lat out of VN range: ${p.lat}`);
  }

  if (typeof p.lng !== 'number' || !Number.isFinite(p.lng)) {
    tag(`bad lng: ${p.lng}`);
  } else if (p.lng < VN_LNG.min || p.lng > VN_LNG.max) {
    tag(`lng out of VN range: ${p.lng}`);
  }

  if (typeof p.category !== 'string' || !ALLOWED_CATEGORIES.has(p.category)) {
    tag(`bad category: ${p.category}`);
  }

  if (!Array.isArray(p.tags)) tag('tags not array');

  for (const k of ['price_min', 'price_max', 'visit_cost', 'duration_minutes', 'popularity', 'rating'] as const) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) tag(`bad ${k}: ${v}`);
  }

  if (typeof p.price_min === 'number' && typeof p.price_max === 'number' && p.price_min > p.price_max) {
    tag(`price_min > price_max (${p.price_min} > ${p.price_max})`);
  }

  if (typeof p.duration_minutes === 'number' && p.duration_minutes <= 0) {
    tag(`duration_minutes <= 0: ${p.duration_minutes}`);
  }

  if (!p.opening_hours || typeof p.opening_hours !== 'object') {
    tag('missing opening_hours');
  } else {
    if (!TIME_RE.test(p.opening_hours.open ?? '')) tag(`bad opening_hours.open: ${p.opening_hours.open}`);
    if (!TIME_RE.test(p.opening_hours.close ?? '')) tag(`bad opening_hours.close: ${p.opening_hours.close}`);
  }

  if (typeof p.is_indoor !== 'boolean') tag(`bad is_indoor: ${p.is_indoor}`);

  if (typeof p.address !== 'string' || !p.address) tag('missing address');

  return issues;
}

function main() {
  const dataDir = path.resolve(__dirname, '../../../data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();

  const allIssues: Issue[] = [];
  const seenIdsGlobal = new Map<string, string>(); // id -> file
  const seenIdsByFile = new Map<string, Set<string>>();
  const seenNameLatLngByFile = new Map<string, Set<string>>();

  let totalRecords = 0;
  const perFile: { file: string; count: number; issues: number; dupIds: number; dupCoordNames: number; bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number } | null }[] = [];

  for (const file of files) {
    const filePath = path.join(dataDir, file);
    let records: PlaceRecord[];
    try {
      records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err: any) {
      allIssues.push({ file, index: -1, problem: `JSON parse error: ${err.message}` });
      perFile.push({ file, count: 0, issues: 1, dupIds: 0, dupCoordNames: 0, bbox: null });
      continue;
    }

    if (!Array.isArray(records)) {
      allIssues.push({ file, index: -1, problem: 'root is not array' });
      continue;
    }

    const fileIds = new Set<string>();
    const fileCoordNames = new Set<string>();
    let dupIds = 0;
    let dupCoordNames = 0;
    let fileIssueCount = 0;
    let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity;

    for (let i = 0; i < records.length; i++) {
      const p = records[i];
      const issues = validateRecord(p, file, i);
      if (issues.length > 0) {
        allIssues.push(...issues);
        fileIssueCount += issues.length;
      }

      if (typeof p.id === 'string' && p.id) {
        if (fileIds.has(p.id)) {
          dupIds++;
          allIssues.push({ file, index: i, id: p.id, name: p.name, problem: 'duplicate id within file' });
        }
        fileIds.add(p.id);

        const seenInFile = seenIdsGlobal.get(p.id);
        if (seenInFile && seenInFile !== file) {
          allIssues.push({ file, index: i, id: p.id, name: p.name, problem: `id also in ${seenInFile}` });
        } else {
          seenIdsGlobal.set(p.id, file);
        }
      }

      if (typeof p.name === 'string' && typeof p.lat === 'number' && typeof p.lng === 'number') {
        const key = `${p.name}|${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`;
        if (fileCoordNames.has(key)) {
          dupCoordNames++;
          allIssues.push({ file, index: i, id: p.id, name: p.name, problem: 'duplicate (name+lat+lng) within file' });
        }
        fileCoordNames.add(key);

        latMin = Math.min(latMin, p.lat);
        latMax = Math.max(latMax, p.lat);
        lngMin = Math.min(lngMin, p.lng);
        lngMax = Math.max(lngMax, p.lng);
      }
    }

    seenIdsByFile.set(file, fileIds);
    seenNameLatLngByFile.set(file, fileCoordNames);
    totalRecords += records.length;
    perFile.push({
      file,
      count: records.length,
      issues: fileIssueCount,
      dupIds,
      dupCoordNames,
      bbox: Number.isFinite(latMin) ? { latMin, latMax, lngMin, lngMax } : null,
    });
  }

  // Report
  console.log('='.repeat(80));
  console.log('VALIDATION REPORT');
  console.log('='.repeat(80));
  console.log(`Files scanned: ${files.length}`);
  console.log(`Total records: ${totalRecords}`);
  console.log(`Total issues:  ${allIssues.length}`);
  console.log('');

  console.log('Per-file summary:');
  console.log('-'.repeat(80));
  console.log(`${'file'.padEnd(34)} ${'count'.padStart(6)} ${'issues'.padStart(7)} ${'dupId'.padStart(6)} ${'dupCN'.padStart(6)}  bbox(lat × lng)`);
  for (const r of perFile) {
    const bbox = r.bbox ? `${r.bbox.latMin.toFixed(2)}-${r.bbox.latMax.toFixed(2)} × ${r.bbox.lngMin.toFixed(2)}-${r.bbox.lngMax.toFixed(2)}` : '-';
    console.log(`${r.file.padEnd(34)} ${String(r.count).padStart(6)} ${String(r.issues).padStart(7)} ${String(r.dupIds).padStart(6)} ${String(r.dupCoordNames).padStart(6)}  ${bbox}`);
  }

  // Issue type breakdown
  const byProblem = new Map<string, number>();
  for (const it of allIssues) {
    const key = it.problem.replace(/[-.\d:]+$/g, '').replace(/\d+/g, 'N').trim();
    byProblem.set(key, (byProblem.get(key) || 0) + 1);
  }
  if (byProblem.size > 0) {
    console.log('\nIssue types:');
    console.log('-'.repeat(80));
    const sorted = [...byProblem.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, v] of sorted) console.log(`  ${String(v).padStart(6)}  ${k}`);
  }

  if (allIssues.length > 0 && allIssues.length <= 50) {
    console.log('\nAll issues:');
    console.log('-'.repeat(80));
    for (const it of allIssues) {
      console.log(`  ${it.file} [#${it.index}] ${it.id ?? '-'} "${it.name ?? '-'}" → ${it.problem}`);
    }
  } else if (allIssues.length > 50) {
    console.log(`\nFirst 30 issues (of ${allIssues.length}):`);
    console.log('-'.repeat(80));
    for (const it of allIssues.slice(0, 30)) {
      console.log(`  ${it.file} [#${it.index}] ${it.id ?? '-'} "${it.name ?? '-'}" → ${it.problem}`);
    }
  }

  process.exit(allIssues.length === 0 ? 0 : 2);
}

main();
