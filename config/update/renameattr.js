// Переименование реквизита объекта (по <Name>) без изменения UUID.
// Использование: node renameattr.js <objXml> <oldName> <newName>
const fs = require('fs');
const [, , file, oldName, newName] = process.argv;
if (!newName) { console.error('usage: node renameattr.js <objXml> <oldName> <newName>'); process.exit(2); }
let t = fs.readFileSync(file, 'utf8');
const needle = `<Name>${oldName}</Name>`;
if (!t.includes(needle)) { console.log(JSON.stringify({ renamed: 0, reason: 'not found' })); process.exit(0); }
if (t.includes(`<Name>${newName}</Name>`)) { console.log(JSON.stringify({ renamed: 0, reason: 'target exists' })); process.exit(0); }
t = t.replace(needle, `<Name>${newName}</Name>`);
fs.writeFileSync(file, t);
console.log(JSON.stringify({ renamed: 1, from: oldName, to: newName }));
