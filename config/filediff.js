// Сравнение двух файловых хэш-карт: node filediff.js <A.json> <B.json> <outPrefix>
const fs = require('fs');
const [, , aP, bP, pre] = process.argv;
if (!pre) { console.error('usage: node filediff.js <A.json> <B.json> <outPrefix>'); process.exit(2); }

const A = JSON.parse(fs.readFileSync(aP, 'utf8'));
const B = JSON.parse(fs.readFileSync(bP, 'utf8'));

const onlyA = [], onlyB = [], changed = [];
for (const k of Object.keys(A)) {
  if (!(k in B)) onlyA.push(k);
  else if (A[k] !== B[k]) changed.push(k);
}
for (const k of Object.keys(B)) if (!(k in A)) onlyB.push(k);

const isBsl = (k) => k.endsWith('.bsl');
const isXml = (k) => k.endsWith('.xml');
const summary = {
  a: Object.keys(A).length, b: Object.keys(B).length,
  onlyA: onlyA.length, onlyB: onlyB.length, changed: changed.length,
  changedBsl: changed.filter(isBsl).length,
  changedXml: changed.filter(isXml).length,
  onlyABsl: onlyA.filter(isBsl).length,
  onlyAXml: onlyA.filter(isXml).length,
};
const w = (s, v) => fs.writeFileSync(pre + '-' + s + '.json', JSON.stringify(v, null, 0));
w('onlyA', onlyA); w('onlyB', onlyB); w('changed', changed);
fs.writeFileSync(pre + '-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
