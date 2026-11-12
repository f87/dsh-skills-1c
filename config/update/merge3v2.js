// Трёхстороннее слияние модулей v2: процедурно-осознанное.
// base - новая версия поставщика, old - старая, ours - наша.
// Переносятся только вставки ours относительно old; каждая вставка привязывается к процедуре-владельцу.
// Использование: node merge3v2.js <base> <old> <ours> <out> [ctx]
const fs = require('fs');

const [, , basePath, oldPath, oursPath, outPath, ctxArg] = process.argv;
if (!outPath) { console.error('usage: node merge3v2.js <base> <old> <ours> <out> [ctx]'); process.exit(2); }
const CTX = ctxArg ? parseInt(ctxArg, 10) : 4;

const read = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
const base = read(basePath);
const oldL = read(oldPath);
const ours = read(oursPath);

const OB = /^\s*(Процедура|Функция)\s+([A-Za-zА-Яа-я_0-9]+)/;
const OE = /^\s*(КонецПроцедуры|КонецФункции)(?![А-Яа-яA-Za-z_0-9])/;

function procs(lines) {
  const list = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OB.exec(lines[i]);
    if (m) {
      let j = i;
      while (j < lines.length && !OE.test(lines[j])) j++;
      list.push({ name: m[2], start: i, end: j });
      i = j;
    }
  }
  return list;
}
const oldProcs = procs(oldL);
const baseProcs = procs(base);
const baseByName = new Map();
for (const p of baseProcs) if (!baseByName.has(p.name)) baseByName.set(p.name, p);
const oldProcAt = (idx) => oldProcs.find((p) => idx >= p.start && idx <= p.end) || null;

// diff old -> ours (по строкам, только вставки/удаления)
function myers(a, b) {
  const N = a.length, M = b.length, max = N + M;
  const v = new Map(), trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0))) x = v.get(k + 1) || 0; else x = (v.get(k - 1) || 0) + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= N && y >= M) return backtrack(trace, a, b, d);
    }
  }
  return [];
}
function backtrack(trace, a, b, dEnd) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d], k = x - y;
    let prevK;
    if (k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0))) prevK = k + 1; else prevK = k - 1;
    const prevX = v.get(prevK) || 0, prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ t: '=', ai: x - 1, bi: y - 1 }); x--; y--; }
    if (x === prevX) { ops.push({ t: '+', bi: y - 1 }); y--; } else { ops.push({ t: '-', ai: x - 1 }); x--; }
  }
  while (x > 0 && y > 0) { ops.push({ t: '=', ai: x - 1, bi: y - 1 }); x--; y--; }
  return ops.reverse();
}

const ops = myers(oldL, ours);
const edits = [];
let i = 0;
while (i < ops.length) {
  if (ops[i].t === '=') { i++; continue; }
  const del = [], ins = [];
  while (i < ops.length && ops[i].t !== '=') {
    if (ops[i].t === '-') del.push(ops[i].ai); else ins.push(ops[i].bi);
    i++;
  }
  // позиция вставки в old: перед первым удалённым или по индексу ближайшей '=' слева
  let oldPos;
  if (del.length) oldPos = del[0];
  else {
    // ищем ближайшую '=' операцию слева от вставки
    oldPos = 0;
    for (let k = i - ins.length - 1; k >= 0; k--) if (ops[k].t === '=') { oldPos = ops[k].ai + 1; break; }
  }
  edits.push({ oldPos, delLines: del.map((x) => oldL[x]), insLines: ins.map((x) => ours[x]), proc: oldProcAt(Math.max(0, oldPos - 1)) });
}

// применяем к base
let result = base.slice();
const log = { applied: 0, fallbackProc: 0, fallbackEnd: 0, conflicts: [] };
// с конца, чтобы индексы не смещались
for (let e = edits.length - 1; e >= 0; e--) {
  const ed = edits[e];
  const ins = ed.insLines;
  if (!ins.length && !ed.delLines.length) continue;

  if (ed.delLines.length) {
    // замена/удаление: ищем точный блок удаляемых строк
    const pos = findSeq(result, ed.delLines);
    if (pos >= 0) { result.splice(pos, ed.delLines.length, ...ins); log.applied++; }
    else log.conflicts.push({ proc: ed.proc && ed.proc.name, reason: 'del-context' });
    continue;
  }

  // чистая вставка
  const proc = ed.proc;
  if (proc) {
    const bproc = baseByName.get(proc.name);
    if (bproc) {
      // контекст: до CTX строк до oldPos внутри процедуры
      const ctx = [];
      for (let j = ed.oldPos - 1; j >= Math.max(proc.start + 1, ed.oldPos - CTX); j--) ctx.unshift(oldL[j]);
      const pos = findSeqInRange(result, ctx, bproc.start, bproc.end);
      if (pos >= 0) { result.splice(pos + ctx.length, 0, ...ins); log.applied++; continue; }
      // fallback: перед КонецПроцедуры
      const endPos = findProcEnd(result, proc.name);
      if (endPos >= 0) { result.splice(endPos, 0, ...ins); log.fallbackProc++; continue; }
    }
  }
  result.push(...ins);
  log.fallbackEnd++;
  log.conflicts.push({ proc: proc && proc.name, reason: 'no-proc' });
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
  if (!seq.length) return -1;
  const last = Math.min(to, arr.length - 1) - seq.length;
  for (let i = Math.max(from, 0); i <= last; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (arr[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
function findProcEnd(arr, name) {
  const rp = /^\s*(Процедура|Функция)\s+([A-Za-zА-Яа-я_0-9]+)/;
  const re = /^\s*(КонецПроцедуры|КонецФункции)(?![А-Яа-яA-Za-z_0-9])/;
  for (let i = 0; i < arr.length; i++) {
    const m = rp.exec(arr[i]);
    if (m && m[2] === name) {
      let j = i;
      while (j < arr.length && !re.test(arr[j])) j++;
      return j < arr.length ? j : -1;
    }
  }
  return -1;
}

fs.writeFileSync(outPath, result.join('\r\n'));
fs.writeFileSync(outPath + '.merge.json', JSON.stringify({ edits: edits.length, ...log }, null, 1));
console.log(JSON.stringify({ edits: edits.length, applied: log.applied, fallbackProc: log.fallbackProc, fallbackEnd: log.fallbackEnd, conflicts: log.conflicts.length }));
