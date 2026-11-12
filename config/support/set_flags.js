// Установка флагов «изменения запрещены» в ParentConfigurations.bin.
// Использование: node set_flags.js <bin> <headerFlag|-> <deliveryFlag|-> [--apply]
//   headerFlag    — значение токена 1 ('0'|'1'|'-' не менять)
//   deliveryFlag  — значение флага каждой поставки ('0'|'1'|'-')
const fs = require('fs');
const [, , binPath, headerArg, deliveryArg, mode] = process.argv;
const apply = mode === '--apply';
if (!binPath) { console.error('usage: node set_flags.js <bin> <headerFlag|-> <deliveryFlag|-> [--apply]'); process.exit(2); }
const raw = fs.readFileSync(binPath, 'utf8');
const tokens = raw.split(',');
if (tokens.join(',') !== raw) { console.error('round-trip не совпал — стоп'); process.exit(3); }
const deliveries = Number(tokens[2]);
let p = 3;
const changed = [];
if (headerArg === '0' || headerArg === '1') { if (tokens[1] !== headerArg) { tokens[1] = headerArg; changed.push('header'); } }
for (let d = 0; d < deliveries; d++) {
  const n = Number(tokens[p + 6]);
  if ((deliveryArg === '0' || deliveryArg === '1') && tokens[p + 1] !== deliveryArg) { tokens[p + 1] = deliveryArg; changed.push('delivery' + d); }
  p = p + 9 + 4 * n;
}
console.log(JSON.stringify({ deliveries, changed, apply }));
if (apply && changed.length) fs.writeFileSync(binPath, tokens.join(','));
