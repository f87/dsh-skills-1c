// Список объектов, затронутых переходом между версиями модуля (по файловым хэшам).
// Использование: node delta-objects.js <changed.json> <onlyB.json> <newTree> <out.json>
const fs = require('fs');
const path = require('path');
const [, , changedPath, onlyBPath, tree, outPath] = process.argv;
const changed = JSON.parse(fs.readFileSync(changedPath, 'utf8'));
const onlyB = JSON.parse(fs.readFileSync(onlyBPath, 'utf8'));

const typeToDir = new Map();
const dirToType = new Map();
for (const d of fs.readdirSync(tree, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === 'Ext') continue;
  const full = path.join(tree, d.name);
  const files = fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.xml'));
  for (const f of files.slice(0, 10)) {
    const head = fs.readFileSync(path.join(full, f.name), 'utf8').slice(0, 4000);
    const m = /<([A-Za-z]+)\s+uuid="/.exec(head);
    if (m) { dirToType.set(d.name, m[1]); if (!typeToDir.has(m[1])) typeToDir.set(m[1], d.name); break; }
  }
}

const objects = new Set();
for (const rel of changed.concat(onlyB)) {
  const parts = rel.split('/');
  if (parts.length < 2) continue;
  const cat = parts[0];
  const type = dirToType.get(cat);
  if (!type) continue;
  const file = parts[1].replace(/\.xml$/, '');
  // вложенные подсистемы: Subsystems/A/Subsystems/B -> Subsystem.A.Subsystem.B
  if (cat === 'Subsystems') {
    const chain = [];
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === 'Subsystems') continue;
      if (i + 1 < parts.length || !parts[i].endsWith('.xml')) { if (i % 2 === 1) chain.push(parts[i]); }
    }
    // надёжнее: собрать пары Subsystems/<name>
    const names = [];
    for (let i = 0; i < parts.length - 1; i++) if (parts[i] === 'Subsystems') names.push(parts[i + 1].replace(/\.xml$/, ''));
    objects.add('Subsystem.' + names.join('.Subsystem.'));
    continue;
  }
  objects.add(type + '.' + file);
}
const list = [...objects].filter((n) => !n.startsWith('Configuration.'));
fs.writeFileSync(outPath, JSON.stringify(list));
console.log(JSON.stringify({ objects: list.length, sample: list.slice(0, 10) }));
