// Трёхстороннее слияние текстовых файлов (модули .bsl) с приоритетом "наших" вставок.
// base - новая версия поставщика, old - старая версия поставщика, ours - наша версия.
// Переносятся только изменения ours относительно old; вставки ищутся в base по контексту.
// Использование: node merge3.js <base> <old> <ours> <out> [contextLines] [--stats]
const fs = require('fs');

function splitLines(s) {
  // сохраняем переводы строк как отдельные символы в конце элементов
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') {
      out.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

function myers(a, b) {
  // возвращает массив операций {t:'=', ' -', '+' , ai, bi}
  const N = a.length, M = b.length;
  const max = N + M;
  const v = new Map();
  const trace = [];
  for (let d = 0; d <= max; d++) {
    const snapshot = new Map(v);
    trace.push(snapshot);
    for (let k = -d; k <= d; k += 2) {
      let x;
      const vk = v.get(k) || 0;
      const vk1 = v.get(k + 1) || 0;
      const vkm1 = v.get(k - 1) || 0;
      if (k === -d || (k !== d && vkm1 < vk1)) x = vk1; else x = vkm1 + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= N && y >= M) {
        return backtrack(trace, a, b, d);
      }
    }
  }
  return [];
}

function backtrack(trace, a, b, dEnd) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && (v.get(k - 1) || 0) < (v.get(k + 1) || 0))) prevK = k + 1; else prevK = k - 1;
    const prevX = v.get(prevK) || 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ t: '=', ai: x - 1, bi: y - 1 }); x--; y--; }
    if (x === prevX) { ops.push({ t: '+', bi: y - 1 }); y--; }
    else { ops.push({ t: '-', ai: x - 1 }); x--; }
  }
  while (x > 0 && y > 0) { ops.push({ t: '=', ai: x - 1, bi: y - 1 }); x--; y--; }
  return ops.reverse();
}

function main() {
  const [, , basePath, oldPath, oursPath, outPath, ctxArg] = process.argv;
  if (!outPath) { console.error('usage: node merge3.js <base> <old> <ours> <out> [context]'); process.exit(2); }
  const ctx = ctxArg ? parseInt(ctxArg, 10) : 3;

  const base = splitLines(fs.readFileSync(basePath, 'utf8'));
  const oldL = splitLines(fs.readFileSync(oldPath, 'utf8'));
  const ours = splitLines(fs.readFileSync(oursPath, 'utf8'));

  const ops = myers(oldL, ours);
  // из операций строим "наши" правки: вставки/удаления относительно old
  const edits = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === '=') { i++; continue; }
    const del = [], ins = [];
    let oldStart = null;
    while (i < ops.length && ops[i].t !== '=') {
      if (ops[i].t === '-') { if (oldStart === null) oldStart = ops[i].ai; del.push(ops[i].ai); }
      else ins.push(ops[i].bi);
      i++;
    }
    edits.push({ oldStart: oldStart === null ? (del.length ? 0 : null) : oldStart, del, ins });
  }

  // применяем правки к base последовательно, ища контекст
  let result = base.slice();
  let offset = 0;
  let applied = 0, conflicts = 0;

  for (const e of edits) {
    // контекст: до 3 строк old перед первой удалённой/вставленной
    const firstOld = e.del.length ? e.del[0] : (e.ins.length ? opsOldIndex(ops, e.ins[0]) : 0);
    let pos = -1;
    if (e.del.length) {
      const needle = e.del.map((ai) => oldL[ai]);
      pos = findBlock(result, needle, 0);
      if (pos >= 0) {
        // заменить удалённые на вставленные
        const insLines = e.ins.map((bi) => ours[bi]);
        result.splice(pos, needle.length, ...insLines);
        applied++;
        continue;
      }
      conflicts++;
      continue;
    }
    // чистая вставка: ищем контекст перед вставкой в old
    const insLines = e.ins.map((bi) => ours[bi]);
    const before = e.ins[0];
    const ctxLines = [];
    for (let j = before - 1; j >= 0 && ctxLines.length < ctx; j--) {
      if (oldL[j] !== undefined) ctxLines.unshift(oldL[j]);
    }
    if (ctxLines.length) {
      pos = findBlockEnd(result, ctxLines, 0);
      if (pos >= 0) {
        result.splice(pos, 0, ...insLines);
        applied++;
        continue;
      }
    }
    // fallback: в конец файла
    result.push(...insLines);
    applied++;
    conflicts++;
  }

  fs.writeFileSync(outPath, result.join(''));
  console.log(JSON.stringify({ edits: edits.length, applied, conflicts, out: outPath }));
}

function opsOldIndex(ops, bi) {
  // индекс в old перед вставкой ours[bi]
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t === '+' && ops[k].bi === bi) {
      // ищем ближайшую '=' операцию слева/справа
      for (let j = k - 1; j >= 0; j--) if (ops[j].t === '=') return ops[j].ai + 1;
      return 0;
    }
  }
  return 0;
}

function findBlock(arr, needle, from) {
  const last = arr.length - needle.length;
  for (let i = from; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (arr[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function findBlockEnd(arr, ctx, from) {
  const p = findBlock(arr, ctx, from);
  return p < 0 ? -1 : p + ctx.length;
}

main();
