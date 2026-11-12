// Сравнение двух манифестов (ConfigDumpInfo) по configVersion.
// Использование: node diff.js <A.json> <B.json> <outPrefix>
// Пишет: <outPrefix>-onlyA.json, -onlyB.json, -changed.json и печатает сводку.
const fs = require('fs');

const [, , aPath, bPath, outPrefix] = process.argv;
if (!aPath || !bPath || !outPrefix) {
  console.error('usage: node diff.js <A.json> <B.json> <outPrefix>');
  process.exit(2);
}

const A = JSON.parse(fs.readFileSync(aPath, 'utf8'));
const B = JSON.parse(fs.readFileSync(bPath, 'utf8'));

const map = (arr) => {
  const m = new Map();
  for (const e of arr) m.set(e.n, e);
  return m;
};
const ma = map(A);
const mb = map(B);

const onlyA = [];
const onlyB = [];
const changed = [];
let same = 0;
let noVersion = 0;

for (const [n, e] of ma) {
  const o = mb.get(n);
  if (!o) { onlyA.push(n); continue; }
  if (e.v && o.v) {
    if (e.v !== o.v) changed.push(n); else same++;
  } else {
    noVersion++;
  }
}
for (const n of mb.keys()) if (!ma.has(n)) onlyB.push(n);

fs.writeFileSync(outPrefix + '-onlyA.json', JSON.stringify(onlyA, null, 0));
fs.writeFileSync(outPrefix + '-onlyB.json', JSON.stringify(onlyB, null, 0));
fs.writeFileSync(outPrefix + '-changed.json', JSON.stringify(changed, null, 0));

const top = (n) => n.split('.').length === 2;
console.log(JSON.stringify({
  aEntries: A.length,
  bEntries: B.length,
  onlyA: onlyA.length,
  onlyA_top: onlyA.filter(top).length,
  onlyB: onlyB.length,
  onlyB_top: onlyB.filter(top).length,
  changed: changed.length,
  changed_top: changed.filter(top).length,
  same,
  noVersion,
}, null, 2));
