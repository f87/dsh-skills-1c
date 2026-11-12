// Статический контроль модулей: дубли имён процедур, незакрытые процедуры, баланс маркеров блоков.
// Использование: node checkprocs.js <tree> [baseTree] [reportJson] [markers.json]
//   markers.json — { "blockStart": "{НашБлок}", "blockEnd": "{/НашБлок}" } (значения по умолчанию);
//   для проекта с другими маркерами передайте свой файл.
// Сравнение с baseTree: проблемы, которые есть и в базе (поставке), не считаются новыми.
// EXIT 1 — есть новые проблемы.
const fs = require('fs');
const path = require('path');

const [, , tree, baseTree, reportPath, markersPath] = process.argv;
if (!tree) { console.error('usage: node checkprocs.js <tree> [baseTree] [report] [markers.json]'); process.exit(2); }

let markers = { blockStart: '{НашБлок}', blockEnd: '{/НашБлок}' };
if (markersPath && fs.existsSync(markersPath)) Object.assign(markers, JSON.parse(fs.readFileSync(markersPath, 'utf8')));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mStart = new RegExp(esc(markers.blockStart));
const mEnd = new RegExp(esc(markers.blockEnd));

const PB = /^\s*(Процедура|Функция)\s+([A-Za-zА-Яа-я_0-9]+)/i;
const PE = /^\s*(КонецПроцедуры|КонецФункции)(?![А-Яа-яA-Za-z_0-9])/i;

function scanFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const seen = new Map();
  const unclosed = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PB.exec(lines[i]);
    if (!m) continue;
    const name = m[2];
    seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) || 0) + 1);
    let j = i;
    while (j < lines.length && !PE.test(lines[j])) j++;
    if (j >= lines.length) unclosed.push(name + ' (стр.' + (i + 1) + ')');
    i = j;
  }
  const dups = [...seen].filter(([, c]) => c > 1).map(([n]) => n);
  let balance = 0;
  for (const l of lines) {
    if (mEnd.test(l)) balance--;
    else if (mStart.test(l)) balance++;
  }
  return { dups, unclosed, balance };
}

function walk(root, rel, out) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(root, r, out);
    else if (e.name.endsWith('.bsl')) out.set(r, scanFile(path.join(root, r)));
  }
}

const current = new Map();
walk(tree, '', current);
const base = new Map();
if (baseTree && fs.existsSync(baseTree)) walk(baseTree, '', base);

const issues = [];
for (const [rel, s] of current) {
  const b = base.get(rel);
  const newDups = s.dups.filter((n) => !b || !b.dups.includes(n));
  const newUnclosed = s.unclosed.filter((n) => !b || !b.unclosed.some((x) => x.startsWith(n.split(' ')[0] + ' ')));
  const markerProblem = s.balance !== 0 && (!b || b.balance === 0);
  if (newDups.length || newUnclosed.length || markerProblem) {
    issues.push({ file: rel, dups: newDups, unclosed: newUnclosed, markerBalance: s.balance });
  }
}
const report = { files: current.size, issues: issues.length, details: issues };
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ files: current.size, issues: issues.length }));
for (const x of issues.slice(0, 20)) {
  console.log('  ' + x.file + ' | дубли: ' + (x.dups.join(',') || '-') + ' | обрывы: ' + (x.unclosed.join(';') || '-') + ' | маркеры: ' + x.markerBalance);
}
process.exit(issues.length ? 1 : 0);
