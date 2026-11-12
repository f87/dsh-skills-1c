// Разворачивает список корневых объектов в полные имена записей .bin (включая реквизиты/формы/макеты).
// Использование: node expand_names.js <bin> <ConfigDumpInfo.xml> <rootsFile> <outFile>
const fs = require('fs');
const [, , binPath, cdiPath, rootsPath, outPath] = process.argv;
const cdi = fs.readFileSync(cdiPath, 'utf8');
const uuidToName = new Map();
for (const m of cdi.matchAll(/<Metadata name="([^"]+)" id="([^"]+)"/g)) uuidToName.set(m[2].toLowerCase(), m[1]);
const raw = fs.readFileSync(binPath, 'utf8');
const tokens = raw.split(',');
let p = 3;
const deliveries = Number(tokens[2]);
const names = [];
for (let d = 0; d < deliveries; d++) {
  const n = Number(tokens[p + 6]);
  for (let i = 0; i < n; i++) {
    const base = p + 7 + i * 4;
    names.push(uuidToName.get(tokens[base + 2].toLowerCase()) || tokens[base + 2]);
  }
  p = p + 9 + 4 * n;
}
const roots = new Set(fs.readFileSync(rootsPath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
const out = names.filter((n) => {
  if (roots.has(n)) return true;
  const parts = n.split('.');
  return roots.has(parts[0] + '.' + parts[1]);
});
fs.writeFileSync(outPath, out.join('\n'));
console.log(JSON.stringify({ deliveries, entries: names.length, roots: roots.size, expanded: out.length }));
