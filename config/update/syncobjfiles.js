// Синхронизация файлов форм/макетов: если объект ссылается на форму/макет, а файла нет — копируем из доноров.
// Использование: node syncobjfiles.js <resTree> <donor1> [donor2 ...]
const fs = require('fs');
const path = require('path');
const [resTree, ...donors] = process.argv.slice(2);

const CATS = new Set();
for (const d of fs.readdirSync(resTree, { withFileTypes: true })) if (d.isDirectory() && d.name !== 'Ext') CATS.add(d.name);

let copied = 0, missing = [];
for (const cat of CATS) {
  const dir = path.join(resTree, cat);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.xml')) continue;
    const name = e.name.slice(0, -4);
    const xml = fs.readFileSync(path.join(dir, e.name), 'utf8');
    for (const tag of ['Form', 'Template']) {
      const re = new RegExp('<' + tag + '>([^<]+)</' + tag + '>', 'g');
      let m;
      while ((m = re.exec(xml)) !== null) {
        const child = m[1];
        const sub = tag === 'Form' ? 'Forms' : 'Templates';
        const relFile = path.join(cat, name, sub, child + '.xml');
        const dst = path.join(resTree, relFile);
        if (fs.existsSync(dst)) continue;
        let found = null;
        for (const d of donors) {
          const src = path.join(d, relFile);
          if (fs.existsSync(src)) { found = src; break; }
        }
        if (found) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(found, dst);
          const srcDir = found.slice(0, -4);
          if (fs.existsSync(srcDir) && !fs.existsSync(dst.slice(0, -4))) fs.cpSync(srcDir, dst.slice(0, -4), { recursive: true });
          copied++;
        } else {
          missing.push(cat + '/' + name + '.' + tag + ':' + child);
        }
      }
    }
  }
}
console.log(JSON.stringify({ copied, missing: missing.length, sample: missing.slice(0, 5) }));
