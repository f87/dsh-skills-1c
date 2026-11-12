// Слияние элементов объектов поставщика: добавляет в base дочерние элементы ours, которых нет в old.
// Использование: node objmerge.js <baseObjXml> <oldObjXml> <ourObjXml> <out> [reportJson]
const fs = require('fs');

const [, , basePath, oldPath, ourPath, outPath, reportPath] = process.argv;
if (!outPath) { console.error('usage: node objmerge.js <base> <old> <ours> <out> [report]'); process.exit(2); }

const base = fs.readFileSync(basePath, 'utf8');
const oldT = fs.readFileSync(oldPath, 'utf8');
const ours = fs.readFileSync(ourPath, 'utf8');

// Возвращает текст блока ChildObjects (внутренность) и его границы
function childObjectsSpan(text) {
  const open = text.indexOf('<ChildObjects>');
  if (open < 0) return null;
  const start = open + '<ChildObjects>'.length;
  const re = /<ChildObjects>|<\/ChildObjects>/g;
  re.lastIndex = start;
  let depth = 1, m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '<ChildObjects>') depth++;
    else {
      depth--;
      if (depth === 0) return { innerStart: start, innerEnd: m.index, closeStart: m.index };
    }
  }
  return null;
}

// Разбор внутренности на элементы верхнего уровня
function splitElements(inner) {
  const els = [];
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt < 0) break;
    // пропускаем комментарии/закрывающие
    if (inner.startsWith('<!--', lt)) { const e = inner.indexOf('-->', lt); i = e < 0 ? inner.length : e + 3; continue; }
    if (inner[lt + 1] === '/') { i = lt + 2; continue; }
    const nameMatch = /^<([A-Za-z0-9:]+)/.exec(inner.slice(lt, lt + 60));
    if (!nameMatch) { i = lt + 1; continue; }
    const tag = nameMatch[1];
    const openEnd = inner.indexOf('>', lt);
    if (openEnd < 0) break;
    const selfClosing = inner[openEnd - 1] === '/';
    let end = openEnd + 1;
    if (!selfClosing) {
      const closeTag = '</' + tag + '>';
      let depth = 1, pos = openEnd + 1;
      while (depth > 0) {
        const nextOpen = inner.indexOf('<' + tag + '>', pos);
        const nextOpenAttr = inner.indexOf('<' + tag + ' ', pos);
        const nextClose = inner.indexOf(closeTag, pos);
        if (nextClose < 0) { end = inner.length; break; }
        const candOpen = nextOpen >= 0 ? nextOpen : Infinity;
        const candOpenAttr = nextOpenAttr >= 0 ? nextOpenAttr : Infinity;
        const cand = Math.min(candOpen, candOpenAttr);
        if (cand < nextClose && cand < Infinity) { depth++; pos = cand + tag.length + 2; }
        else { depth--; end = nextClose + closeTag.length; if (depth === 0) break; pos = nextClose + closeTag.length; }
      }
    }
    els.push(inner.slice(lt, end));
    i = end;
  }
  return els;
}

function nameOf(el) {
  const m = /<Name>([\s\S]*?)<\/Name>/.exec(el);
  return m ? m[1].trim() : null;
}
function kindOf(el) {
  const m = /^<([A-Za-z0-9:]+)/.exec(el);
  return m ? m[1] : '?';
}
function keyOf(el) {
  const k = kindOf(el);
  const n = nameOf(el);
  if (n !== null) return k + '\u0000' + n;
  const u = /uuid="([0-9a-fA-F-]{36})"/.exec(el);
  return k + '\u0000#' + (u ? u[1] : el.slice(0, 120));
}

const report = { baseChildren: 0, oldChildren: 0, ourChildren: 0, added: [], skippedExisting: 0, propertyDiff: false };

const bSpan = childObjectsSpan(base);
const oSpan = childObjectsSpan(oldT);
const uSpan = childObjectsSpan(ours);
if (!bSpan || !oSpan || !uSpan) {
  fs.writeFileSync(outPath, base);
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ error: 'no ChildObjects' }));
  console.log(JSON.stringify({ added: 0, note: 'no ChildObjects' }));
  process.exit(0);
}

const bEls = splitElements(base.slice(bSpan.innerStart, bSpan.innerEnd));
const oEls = splitElements(oldT.slice(oSpan.innerStart, oSpan.innerEnd));
const uEls = splitElements(ours.slice(uSpan.innerStart, uSpan.innerEnd));
report.baseChildren = bEls.length;
report.oldChildren = oEls.length;
report.ourChildren = uEls.length;

const oldKeys = new Set(oEls.map(keyOf));
const baseKeys = new Set(bEls.map(keyOf));
const uuidOf = (el) => { const m = /uuid="([0-9a-fA-F-]{36})"/.exec(el); return m ? m[1].toLowerCase() : null; };
const oldUuids = new Set(oEls.map(uuidOf).filter(Boolean));
const baseUuids = new Set(bEls.map(uuidOf).filter(Boolean));

const inserts = [];
for (const el of uEls) {
  const k = keyOf(el);
  if (oldKeys.has(k)) continue;      // не наша правка
  const u = uuidOf(el);
  if (u && (oldUuids.has(u) || baseUuids.has(u))) { report.skippedExisting++; continue; }
  if (baseKeys.has(k)) { report.skippedExisting++; continue; }
  inserts.push(el);
  report.added.push(k.replace('\u0000', ':'));
}

if (!inserts.length) {
  fs.writeFileSync(outPath, base);
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ added: 0, baseChildren: report.baseChildren }));
  process.exit(0);
}

const block = inserts.map((el) => '\t\t\t' + el.trim() + '\n').join('');
const merged = base.slice(0, bSpan.closeStart) + block + base.slice(bSpan.closeStart);
fs.writeFileSync(outPath, merged);
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ added: inserts.length, baseChildren: report.baseChildren }));
