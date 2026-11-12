// Исправление ссылок на переименованные объекты/реквизиты по UUID.
// Использование: node fixrefs.js <tree> <donorManifest> <baseManifest>
const fs = require('fs');
const path = require('path');
const [, , tree, donorPath, basePath] = process.argv;
const uat = JSON.parse(fs.readFileSync(uatPath, 'utf8'));
const baseCfg = JSON.parse(fs.readFileSync(basePath, 'utf8'));

// карты uuid -> имя для базовой конфигурации и донора
const baseById = new Map();
for (const e of baseCfg) if (e.i) baseById.set(e.i.toLowerCase(), e.n);

const renames = new Map(); // старое имя (последний сегмент) -> новое
for (const e of uat) {
  if (!e.i) continue;
  const en = baseById.get(e.i.toLowerCase());
  if (!en || en === e.n) continue;
  const a = e.n.split('.');
  const b = en.split('.');
  if (a.length !== b.length) continue;
  // последний сегмент (объект, реквизит, ТЧ)
  if (a[a.length - 1] !== b[b.length - 1]) renames.set(a[a.length - 1], b[b.length - 1]);
}

let files = 0, replaced = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!(e.name.endsWith('.xml') || e.name.endsWith('.bsl'))) continue;
    let t;
    try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const before = t;
    for (const [oldName, newName] of renames) {
      if (!t.includes(oldName)) continue;
      const safe = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // только ссылки вида .Имя (типы, пути данных); определения (<Name>) не трогаем
      t = t.replace(new RegExp('\\.' + safe + '(?![A-Za-zА-Яа-я_0-9])', 'g'), '.' + newName);
    }
    if (t !== before) { fs.writeFileSync(full, t); files++; }
  }
}
walk(tree);
console.log(JSON.stringify({ renames: renames.size, files, sample: [...renames].slice(0, 8) }));
