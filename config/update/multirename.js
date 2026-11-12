// Пакетное переименование ссылок на объекты (по списку пар).
// Использование: node multirename.js <tree> <pairs.json>
const fs = require('fs');
const path = require('path');
const [, , tree, pairsPath] = process.argv;
const pairs = JSON.parse(fs.readFileSync(pairsPath, 'utf8')).map(([a, b]) => [a.split('.').pop(), b.split('.').pop()]);

let files = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!(e.name.endsWith('.xml') || e.name.endsWith('.bsl'))) continue;
    let t;
    try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const before = t;
    for (const [o, n] of pairs) {
      if (!t.includes(o)) continue;
      const safe = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp('\\.' + safe + '(?![A-Za-zА-Яа-я_0-9])', 'g'), '.' + n);
      t = t.replace(new RegExp('>' + safe + '<', 'g'), '>' + n + '<');
    }
    if (t !== before) { fs.writeFileSync(full, t); files++; }
  }
}
walk(tree);
console.log(JSON.stringify({ files, pairs: pairs.length }));
