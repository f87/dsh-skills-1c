// Поиск дублей UUID объектов в дереве XML: node dupuuid.js <tree> <out.json>
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const out = process.argv[3];
const map = new Map();
const dups = [];

function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (['Ext', 'Forms', 'Templates', 'Commands', 'Subsystems'].includes(e.name)) continue;
      walk(full, r);
    } else if (e.name.endsWith('.xml') && rel.split('/').length === 1) {
      const head = fs.readFileSync(full, 'utf8').slice(0, 4000);
      const m = /<([A-Za-z]+)\s+uuid="([0-9a-fA-F-]{36})"/.exec(head);
      if (m) {
        const key = m[2].toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
      }
    }
  }
}
walk(root, '');
for (const [k, v] of map) if (v.length > 1) dups.push({ uuid: k, files: v });
fs.writeFileSync(out, JSON.stringify(dups, null, 1));
console.log(JSON.stringify({ objects: map.size, dupUuids: dups.length, sample: dups.slice(0, 3) }));
