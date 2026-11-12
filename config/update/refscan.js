// Поиск ссылок на имена объектов в XML-дереве.
// Использование: node refscan.js <tree> <names.json> <out.json> [--ext xml,bsl]
const fs = require('fs');
const path = require('path');

const [, , tree, namesPath, outPath] = process.argv;
const names = JSON.parse(fs.readFileSync(namesPath, 'utf8')).map((n) => n.split('.').slice(1).join('.'));
const exts = ['.xml', '.bsl'];

const hits = [];
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { walk(full, r); continue; }
    if (!exts.some((x) => e.name.endsWith(x))) continue;
    if (e.name === 'ConfigDumpInfo.xml' || e.name === 'ConfigDumpInfo.xml.bak') continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const found = [];
    for (const nm of names) {
      if (nm && text.includes(nm)) found.push(nm);
    }
    if (found.length) hits.push({ file: r, names: [...new Set(found)] });
  }
}
walk(tree, '');
fs.writeFileSync(outPath, JSON.stringify(hits, null, 1));
console.log(JSON.stringify({ files: hits.length, out: outPath, sample: hits.slice(0, 5) }));
