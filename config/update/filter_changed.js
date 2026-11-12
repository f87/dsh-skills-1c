// Фильтр списка изменённых файлов: оставить только файлы объектов, принадлежащих донорскому модулю.
// Использование: node filter_changed.js <changed.json> <owned.json> <uatNewTree> <out.json>
const fs = require('fs');
const path = require('path');
const [, , changedPath, ownedPath, tree, outPath] = process.argv;
const changed = JSON.parse(fs.readFileSync(changedPath, 'utf8'));
const owned = JSON.parse(fs.readFileSync(ownedPath, 'utf8'));

const typeToDir = new Map();
for (const d of fs.readdirSync(tree, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === 'Ext') continue;
  const full = path.join(tree, d.name);
  const f = fs.readdirSync(full, { withFileTypes: true }).find((e) => e.isFile() && e.name.endsWith('.xml'));
  if (!f) continue;
  const head = fs.readFileSync(path.join(full, f.name), 'utf8').slice(0, 4000);
  const m = /<([A-Za-z]+)\s+uuid="/.exec(head);
  if (m && !typeToDir.has(m[1])) typeToDir.set(m[1], d.name);
}

const dirPrefixes = [];
const fileNames = [];
for (const n of owned) {
  const [t, x] = n.split('.');
  const d = typeToDir.get(t);
  if (!d) continue;
  dirPrefixes.push(d + '/' + x + '/');
  fileNames.push(d + '/' + x + '.xml');
}
const keep = changed.filter((rel) => dirPrefixes.some((p) => rel.startsWith(p)) || fileNames.includes(rel));
fs.writeFileSync(outPath, JSON.stringify(keep));
console.log(JSON.stringify({ changed: changed.length, kept: keep.length, nomIn: keep.includes('Catalogs/Номенклатура.xml') }));
