// Добавление объектов в ChildObjects (Configuration.xml и вложенные подсистемы).
// Использование: node addchild.js <treeDir> <names.json>
// names.json: массив полных имён ("Catalog.X", "Subsystem.A.Subsystem.B").
const fs = require('fs');
const path = require('path');

const [, , tree, listPath] = process.argv;
const names = JSON.parse(fs.readFileSync(listPath, 'utf8'));

const byTarget = new Map(); // relFile -> [entries]

function targetFor(name) {
  const parts = name.split('.');
  if (parts[0] === 'Subsystem' && parts.length > 2) {
    // Subsystem.A.Subsystem.B... -> родительский файл
    const chain = [];
    for (let i = 1; i < parts.length; i += 2) chain.push(parts[i]);
    chain.pop(); // убираем сам объект
    if (!chain.length) return { file: 'Configuration.xml', tag: 'Subsystem', value: parts[1] };
    const dirs = [];
    for (let i = 0; i < chain.length; i++) dirs.push('Subsystems', chain[i]);
    return { file: dirs.join('/') + '.xml', tag: 'Subsystem', value: parts[parts.length - 1] };
  }
  return { file: 'Configuration.xml', tag: parts[0], value: parts[1] };
}

let skippedNotSubordinate = 0;
for (const n of names) {
  const top = n.split('.')[0];
  // В ChildObjects допустимы только подчинённые объекты: Configuration туда попадать не должен
  // (1С: «объект метаданных Configuration не был загружен, поскольку не является подчинённым»).
  if (n.split('.').length < 2 || !/^[A-Za-z]+$/.test(top) || /^(Configuration|ConfigurationExtension)$/.test(top)) {
    skippedNotSubordinate++;
    continue;
  }
  const t = targetFor(n);
  if (!byTarget.has(t.file)) byTarget.set(t.file, []);
  byTarget.get(t.file).push({ tag: t.tag, value: t.value });
}

let added = 0, skipped = 0, missing = 0;
for (const [rel, entries] of byTarget) {
  const file = path.join(tree, rel);
  if (!fs.existsSync(file)) { missing++; continue; }
  let text = fs.readFileSync(file, 'utf8');
  const close = text.lastIndexOf('</ChildObjects>');
  if (close < 0) { missing++; continue; }
  const inserts = [];
  for (const e of entries) {
    const needle = `<${e.tag}>${e.value}</${e.tag}>`;
    if (text.includes(needle)) { skipped++; continue; }
    if (!inserts.some((x) => x.needle === needle)) inserts.push({ needle, tag: e.tag, value: e.value });
  }
  if (!inserts.length) continue;
  const block = inserts.map((x) => '\t\t\t' + x.needle + '\n').join('');
  text = text.slice(0, close) + block + text.slice(close);
  fs.writeFileSync(file, text);
  added += inserts.length;
}
console.log(JSON.stringify({ added, skipped, skippedNotSubordinate, missingFiles: missing, targets: byTarget.size }));
