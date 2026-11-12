// Перенос процедур, добавленных в current, но не попавших в результат слияния.
// Использование: node carryprocs.js <resultFile> <currentFile> [reportJson] [regionName]
// Переносит процедуру, если её имени нет в результате и она:
//   - находится в области "#Область <regionName>" файла current (по умолчанию "НашаОбласть"), ЛИБО
//   - упоминается в тексте результата (вызов/ссылка по имени).
// Повторяет проход до неподвижной точки: перенесённая процедура может вызывать ещё не перенесённые.

const fs = require('fs');

const [, , resPath, curPath, reportPath, regionArg] = process.argv;
if (!resPath || !curPath) { console.error('usage: node carryprocs.js <result> <current> [report] [region]'); process.exit(2); }
const REGION = regionArg || 'НашаОбласть';

const PB = /^\s*(Процедура|Функция)\s+([A-Za-zА-Яа-я_0-9]+)/i;
const PE = /^\s*(КонецПроцедуры|КонецФункции)(?![А-Яа-яA-Za-z_0-9])/i;

function procs(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PB.exec(lines[i]);
    if (!m) continue;
    let j = i;
    while (j < lines.length && !PE.test(lines[j])) j++;
    let start = i;
    while (start > 0 && /^\s*&[A-Za-zА-Яа-я]+/.test(lines[start - 1])) start--;
    out.push({ name: m[2], start, sig: i, end: j });
    i = j;
  }
  return out;
}

function regionRanges(lines) {
  const regions = [];
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^\\s*#Область\\s+' + REGION + '\\s*$', 'i').test(lines[i])) {
      let depth = 1, j = i + 1;
      for (; j < lines.length; j++) {
        if (/^\s*#Область\b/i.test(lines[j])) depth++;
        else if (/^\s*#КонецОбласти\b/i.test(lines[j])) { depth--; if (depth === 0) break; }
      }
      regions.push({ start: i, end: j });
      i = j;
    }
  }
  return regions;
}

const resBuf = fs.readFileSync(resPath);
const hasBom = resBuf.length >= 3 && resBuf[0] === 0xEF && resBuf[1] === 0xBB && resBuf[2] === 0xBF;
let resLines = resBuf.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
const curLines = fs.readFileSync(curPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
const regions = regionRanges(curLines);

const appended = [];
// повторяем до неподвижной точки: перенесённая процедура может вызывать ещё не перенесённые
let progress = true;
while (progress) {
  progress = false;
  const resText = resLines.join('\n');
  const resNamesNow = new Set(procs(resLines).map((p) => p.name.toLowerCase()));
  for (const p of procs(curLines)) {
    if (resNamesNow.has(p.name.toLowerCase())) continue;
    const inRegion = regions.some((r) => p.sig >= r.start && p.sig <= r.end);
    const referenced = new RegExp('(^|[^A-Za-zА-Яа-я_0-9])' + p.name + '([^A-Za-zА-Яа-я_0-9]|$)', 'i').test(resText);
    if (!inRegion && !referenced) continue;
    resLines.push('', ...curLines.slice(p.start, p.end + 1));
    resNamesNow.add(p.name.toLowerCase());
    appended.push(p.name + (inRegion ? ' (область ' + REGION + ')' : ' (по ссылке)'));
    progress = true;
  }
}

if (appended.length) {
  fs.writeFileSync(resPath, (hasBom ? '\uFEFF' : '') + resLines.join('\r\n'), 'utf8');
}
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ appended }, null, 1));
console.log(JSON.stringify({ appended: appended.length, names: appended }));
