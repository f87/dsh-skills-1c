// Установка уровней поддержки в Ext\ParentConfigurations.bin по полным именам записей.
// Использование:
//   node set_levels.js <bin> <ConfigDumpInfo.xml> <namesFile> <0|1|2> [--apply] [--delivery N]
// Без --apply — только отчёт. Меняются ТОЛЬКО токены уровней; структура и порядок сохраняются.
const fs = require('fs');
const argv = process.argv.slice(2);
let binPath, cdiPath, namesPath, levelArg;
let apply = false, deliveryFilter = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--apply') apply = true;
  else if (a === '--delivery') deliveryFilter = Number(argv[++i]);
  else if (binPath === undefined) binPath = a;
  else if (cdiPath === undefined) cdiPath = a;
  else if (namesPath === undefined) namesPath = a;
  else if (levelArg === undefined) levelArg = a;
}
const level = String(parseInt(levelArg, 10));
if (!binPath || !cdiPath || !namesPath || !/^[012]$/.test(level)) {
  console.error('usage: node set_levels.js <bin> <ConfigDumpInfo.xml> <namesFile> <0|1|2> [--apply] [--delivery N]');
  process.exit(2);
}

const cdi = fs.readFileSync(cdiPath, 'utf8');
const uuidToName = new Map();
for (const m of cdi.matchAll(/<Metadata name="([^"]+)" id="([^"]+)"/g)) uuidToName.set(m[2].toLowerCase(), m[1]);

const raw = fs.readFileSync(binPath, 'utf8');
const tokens = raw.split(',');
if (tokens.join(',') !== raw) { console.error('round-trip не совпал — стоп'); process.exit(3); }

const deliveries = Number(tokens[2]);
let p = 3;
const entries = [];
for (let d = 0; d < deliveries; d++) {
  const n = Number(tokens[p + 6]);
  for (let i = 0; i < n; i++) {
    const base = p + 7 + i * 4;
    const uuid = tokens[base + 2];
    entries.push({ d, levelIdx: base, name: uuidToName.get(uuid.toLowerCase()) || uuid });
  }
  p = p + 9 + 4 * n;
}

const names = fs.readFileSync(namesPath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const want = new Set(names);
let matched = 0, changed = 0;
const missing = [];
for (const e of entries) {
  if (deliveryFilter !== null && e.d !== deliveryFilter) continue;
  if (!want.has(e.name)) continue;
  matched++;
  if (tokens[e.levelIdx] !== level) { tokens[e.levelIdx] = level; changed++; }
}
for (const n of names) {
  const found = entries.some((e) => e.name === n && (deliveryFilter === null || e.d === deliveryFilter));
  if (!found) missing.push(n);
}
console.log(JSON.stringify({ deliveries, entries: entries.length, headerFlag: tokens[1], delivery: deliveryFilter, names: names.length, matched, changed, missing: missing.length, apply }));
if (missing.length) console.log('примеры не найденных: ' + missing.slice(0, 8).join('; '));
if (apply && changed) { fs.writeFileSync(binPath, tokens.join(',')); console.log('записано, изменено уровней: ' + changed); }
