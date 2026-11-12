// Хэши всех файлов дерева: node hash.js <treeDir> <out.json>
// Результат: {relPath: "size:sha1"}
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , tree, out] = process.argv;
if (!out) { console.error('usage: node hash.js <treeDir> <out.json>'); process.exit(2); }

const res = Object.create(null);
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(full, r);
    else if (e.isFile()) {
      try {
        const buf = fs.readFileSync(full);
        const h = crypto.createHash('sha1').update(buf).digest('hex');
        res[r] = buf.length + ':' + h;
      } catch (err) {
        res[r] = 'ERR:' + err.code;
      }
    }
  }
}
walk(tree, '');
fs.writeFileSync(out, JSON.stringify(res));
console.log(JSON.stringify({ tree, files: Object.keys(res).length, out }));
