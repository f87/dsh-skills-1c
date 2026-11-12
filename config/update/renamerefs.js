// Замена ССЫЛОК на переименованный реквизит в XML/BSL дерева.
// Ограничения:
//   1) определения <Name>…</Name> не переименовываются;
//   2) если передан <updateTree>, файлы, ПОБАЙТНО совпадающие с поставкой, не трогаются;
//      наши изменённые файлы по пути поставки обрабатываются;
//   3) замена только по границам идентификатора, не внутри составных имён.
// Использование: node renamerefs.js <tree> <oldName> <newName> [<updateTree>]
const fs = require('fs');
const path = require('path');
const [, , tree, oldName, newName, updateTree] = process.argv;
if (!newName) { console.error('usage: node renamerefs.js <tree> <old> <new> [<updateTree>]'); process.exit(2); }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = 'A-Za-zА-Яа-яЁё0-9_';
const re = new RegExp('(?<![' + WORD + '])' + esc(oldName) + '(?![' + WORD + '])', 'g');

let files = 0, changed = 0, skippedVendor = 0, processedVendorChanged = 0;
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { walk(full, r); continue; }
    if (!(e.name.endsWith('.xml') || e.name.endsWith('.bsl'))) continue;
    let t;
    try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (updateTree) {
      const up = path.join(updateTree, r);
      if (fs.existsSync(up)) {
        const ub = fs.readFileSync(up);
        if (ub.equals(Buffer.from(t, 'utf8'))) { skippedVendor++; continue; }
        processedVendorChanged++;
      }
    }
    files++;
    if (!t.includes(oldName)) continue;
    const before = t;
    // 1. защитить определения
    t = t.replace(/<Name>([^<]*)<\/Name>/g, (m, inner) => '<Name>' + inner.replace(re, '\u0000DEF\u0000') + '</Name>');
    // 2. заменить ссылки по границам идентификатора
    t = t.replace(re, newName);
    // 3. вернуть определения
    t = t.replace(/\u0000DEF\u0000/g, oldName);
    if (t !== before) { fs.writeFileSync(full, t); changed++; }
  }
}
walk(tree, '');
console.log(JSON.stringify({ files, changed, skippedVendor, processedVendorChanged }));
