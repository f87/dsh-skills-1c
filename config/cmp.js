// Классифицированное сравнение двух манифестов по configVersion.
// Использование: node cmp.js <A.json> <B.json> <outPrefix>
// Выход: <prefix>-changedModules.json, -changedTop.json, -changedForms.json,
//        -changedFormsData.json, -onlyA.json, -onlyB.json, <prefix>-summary.json
const fs = require('fs');

const [, , aP, bP, pre] = process.argv;
if (!pre) { console.error('usage: node cmp.js <A.json> <B.json> <outPrefix>'); process.exit(2); }

const A = JSON.parse(fs.readFileSync(aP, 'utf8'));
const B = JSON.parse(fs.readFileSync(bP, 'utf8'));
const map = (x) => { const m = new Map(); for (const e of x) m.set(e.n, e); return m; };
const ma = map(A), mb = map(B);

const changed = [];
const onlyA = [];
for (const [n, e] of ma) {
  const o = mb.get(n);
  if (!o) { onlyA.push(n); continue; }
  if (e.v && o.v && e.v !== o.v) changed.push(n);
}
const onlyB = [];
for (const n of mb.keys()) if (!ma.has(n)) onlyB.push(n);

const isModule = (n) => /\.Module$/.test(n);
const isTop = (n) => n.split('.').length === 2;
const isForm = (n) => /\.Form\.[^.]+\.Form$/.test(n);

const changedModules = changed.filter(isModule);
const changedTop = changed.filter(isTop);
const changedFormsData = changed.filter(isForm);
const changedForms = changed.filter((n) => /\.Form\.[^.]+$/.test(n));

const w = (s, v) => fs.writeFileSync(pre + '-' + s + '.json', JSON.stringify(v, null, 0));
w('changedModules', changedModules);
w('changedTop', changedTop);
w('changedForms', changedForms);
w('changedFormsData', changedFormsData);
w('onlyA', onlyA);
w('onlyB', onlyB);

const summary = {
  a: A.length, b: B.length,
  changed: changed.length,
  changedModules: changedModules.length,
  changedTop: changedTop.length,
  changedFormsData: changedFormsData.length,
  onlyA: onlyA.length, onlyB: onlyB.length,
};
fs.writeFileSync(pre + '-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
