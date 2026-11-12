// Копирование объектов из донора в результат.
// Использование: node copyfrom.js <donorTree> <outTree> <names.json> [replace]
//   replace — удалить прежние файлы объекта перед копированием (чистая замена)
const fs = require('fs');
const path = require('path');
const [, , donorTree, outTree, namesPath, mode] = process.argv;
const REPLACE = mode === 'replace';
const names = JSON.parse(fs.readFileSync(namesPath, 'utf8'));

const typeToDir = new Map();
for (const d of fs.readdirSync(donorTree, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === 'Ext') continue;
  const full = path.join(donorTree, d.name);
  const files = fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.xml'));
  for (const f of files.slice(0, 5)) {
    const head = fs.readFileSync(path.join(full, f.name), 'utf8').slice(0, 4000);
    const m = /<([A-Za-z]+)\s+uuid="/.exec(head);
    if (m) { if (!typeToDir.has(m[1])) typeToDir.set(m[1], d.name); break; }
  }
}

let copied = 0, skipped = 0;
for (const n of names) {
  if (/^Subsystem\.[^.]+(?:\.Subsystem\.[^.]+)+$/.test(n)) {
    const parts = n.split('.');
    const rel = [];
    for (let i = 0; i < parts.length; i += 2) rel.push('Subsystems', parts[i + 1]);
    const relBase = rel.join(path.sep);
    const srcFile = path.join(donorTree, relBase + '.xml');
    const srcDir = path.join(donorTree, relBase);
    if (REPLACE) { for (const p of [path.join(outTree, relBase + '.xml'), path.join(outTree, relBase)]) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} } }
    if (fs.existsSync(srcFile)) { fs.mkdirSync(path.dirname(path.join(outTree, relBase)), { recursive: true }); fs.copyFileSync(srcFile, path.join(outTree, relBase + '.xml')); copied++; }
    if (fs.existsSync(srcDir)) { fs.cpSync(srcDir, path.join(outTree, relBase), { recursive: true }); copied++; }
    continue;
  }
  const [type, name] = n.split('.');
  const dir = typeToDir.get(type);
  if (!dir) { skipped++; continue; }
  if (REPLACE) { for (const p of [path.join(outTree, dir, name + '.xml'), path.join(outTree, dir, name)]) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} } }
  const srcFile = path.join(donorTree, dir, name + '.xml');
  const srcDir = path.join(donorTree, dir, name);
  let ok = false;
  if (fs.existsSync(srcFile)) { fs.mkdirSync(path.join(outTree, dir), { recursive: true }); fs.copyFileSync(srcFile, path.join(outTree, dir, name + '.xml')); ok = true; }
  if (fs.existsSync(srcDir)) { fs.cpSync(srcDir, path.join(outTree, dir, name), { recursive: true }); ok = true; }
  if (ok) copied++; else skipped++;
}
console.log(JSON.stringify({ copied, skipped, replace: REPLACE }));
