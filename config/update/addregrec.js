// Добавление записи регистра в список движений документа.
// Использование: node addregrec.js <baseDocXml> <donorDocXml> <RegisterFullName>
const fs = require('fs');
const [, , basePath, donorPath, regName] = process.argv;
if (!regName) { console.error('usage: node addregrec.js <base> <donor> <AccumulationRegister.X>'); process.exit(2); }

let base = fs.readFileSync(basePath, 'utf8');
const donor = fs.readFileSync(donorPath, 'utf8');
const item = `<xr:Item xsi:type="xr:MDObjectRef">${regName}</xr:Item>`;
if (base.includes(item)) { console.log(JSON.stringify({ added: 0, reason: 'exists' })); process.exit(0); }
if (!donor.includes(item)) { console.log(JSON.stringify({ added: 0, reason: 'not in donor' })); process.exit(0); }

const closeIdx = base.indexOf('</RegisterRecords>');
if (closeIdx >= 0) {
  base = base.slice(0, closeIdx) + '\t\t\t\t' + item + '\n\t\t\t' + base.slice(closeIdx);
} else {
  // списка движений нет — добавляем блок в Properties перед </Properties>
  const pClose = base.indexOf('</Properties>');
  if (pClose < 0) { console.error('no Properties'); process.exit(3); }
  const block = `\t\t\t<RegisterRecords>\n\t\t\t\t${item}\n\t\t\t</RegisterRecords>\n\t\t`;
  base = base.slice(0, pClose) + block + base.slice(pClose);
}
fs.writeFileSync(basePath, base);
console.log(JSON.stringify({ added: 1 }));
