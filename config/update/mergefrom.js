// Слияние объектов, существующих в базовой конфигурации, но затронутых дельтой модуля.
// Использование: node mergefrom.js <newTree> <oldTree> <baseTree> <outTree> <names.json>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [, , newTree, oldTree, v1Tree, outTree, namesPath] = process.argv;
const names = JSON.parse(fs.readFileSync(namesPath, 'utf8'));
const scripts = __dirname;

const typeToDir = new Map();
for (const d of fs.readdirSync(newTree, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === 'Ext') continue;
  const full = path.join(newTree, d.name);
  const files = fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.xml'));
  for (const f of files.slice(0, 8)) {
    const head = fs.readFileSync(path.join(full, f.name), 'utf8').slice(0, 4000);
    const m = /<([A-Za-z]+)\s+uuid="/.exec(head);
    if (m) { if (!typeToDir.has(m[1])) typeToDir.set(m[1], d.name); break; }
  }
}

let merged = 0, copied = 0, missing = [];
for (const n of names) {
  const [type, name] = n.split('.');
  const dir = typeToDir.get(type);
  if (!dir) { missing.push(n); continue; }
  const rel = path.join(dir, name + '.xml');
  const B = path.join(outTree, rel);      // текущий результат (V1)
  const O = path.join(oldTree, dir, name + '.xml');
  const U = path.join(newTree, dir, name + '.xml');
  if (!fs.existsSync(B) || !fs.existsSync(U)) { missing.push(n); continue; }
  if (fs.existsSync(O)) {
    try { execFileSync('node', [path.join(scripts, 'objmerge.js'), B, O, U, B], { encoding: 'utf8' }); merged++; }
    catch (e) { missing.push(n + ':merge'); }
  }
  // файлы дочерних элементов из дельты модуля
  const srcDir = path.join(newTree, dir, name);
  const dstDir = path.join(outTree, dir, name);
  if (fs.existsSync(srcDir)) {
    for (const f of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const s = path.join(srcDir, f.name), d = path.join(dstDir, f.name);
      if (!fs.existsSync(d)) { fs.mkdirSync(dstDir, { recursive: true }); fs.cpSync(s, d, { recursive: true }); copied++; }
    }
  }
}
console.log(JSON.stringify({ merged, copied, missing: missing.length, sample: missing.slice(0, 5) }));
