// Список полных имён записей выбранной поставки .bin.
// Использование: node dump_names.js <bin> <ConfigDumpInfo.xml> <deliveryIndex> <outFile>
const fs = require('fs');
const [, , binPath, cdiPath, deliveryArg, outPath] = process.argv;
const delivery = Number(deliveryArg);
const cdi = fs.readFileSync(cdiPath, 'utf8');
const uuidToName = new Map();
for (const m of cdi.matchAll(/<Metadata name="([^"]+)" id="([^"]+)"/g)) uuidToName.set(m[2].toLowerCase(), m[1]);
const raw = fs.readFileSync(binPath, 'utf8');
const tokens = raw.split(',');
const deliveries = Number(tokens[2]);
if (!(delivery >= 0 && delivery < deliveries)) { console.error('нет такой поставки: ' + delivery + ' из ' + deliveries); process.exit(2); }
let p = 3;
for (let d = 0; d < deliveries; d++) {
  const n = Number(tokens[p + 6]);
  if (d === delivery) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const base = p + 7 + i * 4;
      out.push(uuidToName.get(tokens[base + 2].toLowerCase()) || tokens[base + 2]);
    }
    fs.writeFileSync(outPath, out.join('\n'));
    console.log(JSON.stringify({ delivery, entries: n, out: outPath }));
    process.exit(0);
  }
  p = p + 9 + 4 * n;
}
