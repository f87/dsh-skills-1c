// Манифест дерева XML: разбор ConfigDumpInfo.xml -> [{n: имя, i: id, v: configVersion}]
// Использование: node manifest.js <каталог дерева> <выходной.json>
const fs = require('fs');
const path = require('path');

const tree = process.argv[2];
const out = process.argv[3];
if (!tree || !out) {
  console.error('usage: node manifest.js <treeDir> <out.json>');
  process.exit(2);
}

const file = path.join(tree, 'ConfigDumpInfo.xml');
if (!fs.existsSync(file)) {
  console.error('ConfigDumpInfo.xml не найден: ' + file);
  process.exit(3);
}

const s = fs.readFileSync(file, 'utf8');
const entries = [];
const re = /<Metadata\s+([^>]*?)\/?>/g;
let m;
while ((m = re.exec(s)) !== null) {
  const attrs = m[1];
  const nm = /name="([^"]*)"/.exec(attrs);
  if (!nm) continue;
  const id = /id="([^"]*)"/.exec(attrs);
  const v = /configVersion="([^"]*)"/.exec(attrs);
  entries.push({ n: nm[1], i: id ? id[1] : null, v: v ? v[1] : null });
}

fs.writeFileSync(out, JSON.stringify(entries));
const withV = entries.filter((e) => e.v).length;
console.log(JSON.stringify({ file: out, entries: entries.length, withVersion: withV }));
