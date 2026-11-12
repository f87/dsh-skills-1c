// Слияние модулей блоками: переносит вставки из «наших» блоков в новую версию поставщика,
// привязывая каждую к процедуре-владельцу. Заменяемые процедуры берутся из ours целиком.
// Использование: node blockmerge.js <base> <old> <ours> <out> [replaceList.json]
const fs = require('fs');

const [, , basePath, oldPath, oursPath, outPath, replacePath] = process.argv;
if (!outPath) { console.error('usage: node blockmerge.js <base> <old> <ours> <out> [replace.json]'); process.exit(2); }

const read = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
const base = read(basePath);
const oldL = read(oldPath);
const ours = read(oursPath);
const replaceProcs = replacePath && fs.existsSync(replacePath) ? new Set(JSON.parse(fs.readFileSync(replacePath, 'utf8'))) : new Set();

// маркеры блоков: 6-й аргумент markers.json ({ blockStart, blockEnd, region })
const markersPath = process.argv[7];
// маркеры блоков по умолчанию условные; реальные задаются markers.json
let markers = { blockStart: '{НашБлок}', blockEnd: '{/НашБлок}', region: 'НашаОбласть' };
if (markersPath && fs.existsSync(markersPath)) Object.assign(markers, JSON.parse(fs.readFileSync(markersPath, 'utf8')));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mBlockStart = new RegExp('^\\s*\\/\\/\\s*' + esc(markers.blockStart));
const mBlockEnd = new RegExp('\\/\\/\\s*' + esc(markers.blockEnd));
const mRegion = new RegExp('^\\s*#Область\\s+' + esc(markers.region));

const PB = /^\s*(Процедура|Функция)\s+([A-Za-zА-Яа-я_0-9]+)/;
const PE = /^\s*(КонецПроцедуры|КонецФункции)(?![А-Яа-яA-Za-z_0-9])/i;

function procList(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PB.exec(lines[i]);
    if (m) {
      let j = i;
      while (j < lines.length && !PE.test(lines[j])) j++;
      out.push({ name: m[2], start: i, end: j });
      i = j;
    }
  }
  return out;
}
function procAt(list, idx) {
  return list.find((p) => idx >= p.start && idx <= p.end) || null;
}

// --- наши блоки ---
function ourBlocks(lines) {
  const list = [];
  for (let i = 0; i < lines.length; i++) {
    if (mBlockStart.test(lines[i]) && !mBlockEnd.test(lines[i])) {
      let j = i;
      while (j < lines.length && !mBlockEnd.test(lines[j])) j++;
      list.push({ start: i, end: j, kind: 'block' });
      i = j;
    } else if (mRegion.test(lines[i])) {
      let j = i;
      while (j < lines.length && !/^\s*#КонецОбласти/.test(lines[j])) j++;
      list.push({ start: i, end: j, kind: 'slaver' });
      i = j;
    }
  }
  return list;
}

const ourProcs = procList(ours);
const baseProcs = procList(base);
const baseByName = new Map();
for (const p of baseProcs) if (!baseByName.has(p.name)) baseByName.set(p.name, p);
const oldProcs = procList(oldL);
const oldByName = new Map();
for (const p of oldProcs) if (!oldByName.has(p.name)) oldByName.set(p.name, p);

const blocks = ourBlocks(ours);
const log = { blocks: blocks.length, replProcs: 0, byContext: 0, endOfProc: 0, replacedProc: 0, moduleEnd: 0, manual: [] };

// --- замена процедур целиком ---
let work = base.slice();
const replaced = [];
for (const name of replaceProcs) {
  const o = ourProcs.find((p) => p.name === name);
  const b = baseByName.get(name);
  if (!o) continue;
  if (!b) { log.manual.push({ proc: name, reason: 'no base proc for replace' }); continue; }
  // Текст процедуры без строк-маркеров (они могут стоять до сигнатуры и сразу после неё).
  let body = ours.slice(o.start, o.end + 1);
  // шапка вида: // {УАТ} / сигнатура / // {/УАТ} — убираем закрывающий маркер из тела
  if (body.length >= 2 && mBlockEnd.test(body[1]) && !mBlockStart.test(body[1])) body = [body[0], ...body.slice(2)];
  work.splice(b.start, b.end - b.start + 1, ...body);
  replaced.push(name);
  log.replProcs++;
  // обернуть заменённую процедуру маркерами целиком (если их ещё нет)
  let nb = procList(work).find((p) => p.name === name);
  if (nb) {
    const before = nb.start > 0 ? work[nb.start - 1] : '';
    const after = nb.end + 1 < work.length ? work[nb.end + 1] : '';
    if (!(mBlockStart.test(before) && mBlockEnd.test(after))) {
      work.splice(nb.end + 1, 0, '// ' + markers.blockEnd);
      work.splice(nb.start, 0, '// ' + markers.blockStart);
    }
  }
  baseByName.clear();
  for (const p of procList(work)) if (!baseByName.has(p.name)) baseByName.set(p.name, p);
}

// вставки блоками, с конца файла
const inserts = [];
for (const bl of blocks) {
  // блок-«шапка» (маркер, сигнатура, закрывающий маркер): владельца ищем по следующей строке
  let p = procAt(ourProcs, bl.start);
  const header = !p && PB.test(ours[bl.start + 1] || '');
  if (header) p = procAt(ourProcs, bl.start + 1);
  const blockText = ours.slice(bl.start, bl.end + 1);
  inserts.push({ bl, p, header, blockText });
}

// применяем по убыванию позиции в ours — порядок не важен, ищем по контенту в work
for (let k = inserts.length - 1; k >= 0; k--) {
  const { bl, p, blockText } = inserts[k];
  // уже есть такой блок в work?
  if (findSeq(work, blockText) >= 0) continue;

  const procName = p ? p.name : null;
  if (p && inserts[k].header) {
    // маркеры вокруг сигнатуры: не вставляем текст блока (в нём дубль сигнатуры),
    // а оборачиваем существующую процедуру целиком
    const bp = currentProc(work, procName);
    if (bp) {
      const before = bp.start > 0 ? work[bp.start - 1] : '';
      const after = bp.end + 1 < work.length ? work[bp.end + 1] : '';
      if (!(mBlockStart.test(before) && mBlockEnd.test(after))) {
        work.splice(bp.end + 1, 0, '// ' + markers.blockEnd);
        work.splice(bp.start, 0, '// ' + markers.blockStart);
      }
      log.byContext++;
    } else {
      log.manual.push({ proc: procName, reason: 'header markers, proc missing' });
    }
    continue;
  }
  if (procName) {
    const bp = currentProc(work, procName);
    if (bp) {
      // контекст: 4 строки перед блоком в ours (в пределах процедуры)
      const ctx = [];
      for (let j = bl.start - 1; j >= Math.max(p.start + 1, bl.start - 4); j--) ctx.unshift(ours[j]);
      const pos = ctx.length ? findSeqInRange(work, ctx, bp.start, bp.end) : -1;
      if (pos >= 0) { work.splice(pos + ctx.length, 0, ...blockText); log.byContext++; continue; }
      // блок в конце процедуры?
      let tail = 0;
      for (let j = bl.end + 1; j < p.end; j++) if (ours[j].trim()) tail++;
      if (tail === 0) {
        const endPos = currentProc(work, procName).end;
        work.splice(endPos, 0, ...blockText);
        log.endOfProc++;
        continue;
      }
      // процедура не менялась поставщиком -> заменяем целиком
      const op = oldByName.get(procName);
      const bp2 = currentProc(work, procName);
      if (op && bp2 && sameLines(oldL, op, work, bp2)) {
        const newText = ours.slice(p.start, p.end + 1);
        work.splice(bp2.start, bp2.end - bp2.start + 1, ...newText);
        log.replacedProc++;
        continue;
      }
      work.splice(currentProc(work, procName).end, 0, ...blockText);
      log.manual.push({ proc: procName, reason: 'mid-proc, base changed', tail });
      log.endOfProc++;
      continue;
    }
    // процедуры нет в новой версии
    if (!blockText.some((x) => PE.test(x))) {
      log.manual.push({ proc: procName, reason: 'signature without end — skipped' });
      continue;
    }
    work.push('', '// ' + markers.blockStart + ' процедура отсутствует в новой версии поставщика: ' + procName, ...blockText);
    log.manual.push({ proc: procName, reason: 'proc missing in base' });
    log.moduleEnd++;
    continue;
  }
  // блочный уровень модуля
  if (blockText.some((x) => PB.test(x)) && !blockText.some((x) => PE.test(x))) {
    log.manual.push({ reason: 'block with signature without end — skipped' });
    continue;
  }
  work = work.concat([''], blockText);
  log.moduleEnd++;
}

function currentProc(lines, name) {
  const list = procList(lines);
  return list.find((p) => p.name === name) || null;
}
function sameLines(a, pa, b, pb) {
  if (pa.end - pa.start !== pb.end - pb.start) return false;
  for (let i = 0; i <= pa.end - pa.start; i++) if (a[pa.start + i] !== b[pb.start + i]) return false;
  return true;
}
function findSeq(arr, seq) {
  if (!seq.length) return -1;
  for (let i = 0; i <= arr.length - seq.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (arr[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
function findSeqInRange(arr, seq, from, to) {
  const last = Math.min(to, arr.length - 1) - seq.length;
  for (let i = Math.max(from, 0); i <= last; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (arr[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

fs.writeFileSync(outPath, work.join('\r\n'));
fs.writeFileSync(outPath + '.merge.json', JSON.stringify({ ...log, replaced }, null, 1));
console.log(JSON.stringify({ blocks: log.blocks, repl: log.replProcs, ctx: log.byContext, eop: log.endOfProc, replProc: log.replacedProc, end: log.moduleEnd, manual: log.manual.length }));
