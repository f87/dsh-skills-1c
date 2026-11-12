// Добавление конкретных реквизитов из донора в объект результата.
// Использование: node addattr.js <baseObjXml> <donorObjXml> <Name1,Name2,...>
const fs = require('fs');
const [, , basePath, donorPath, namesArg] = process.argv;
if (!namesArg) { console.error('usage: node addattr.js <base> <donor> <names>'); process.exit(2); }
const names = namesArg.split(',').map((s) => s.trim()).filter(Boolean);

const base = fs.readFileSync(basePath, 'utf8');
const donor = fs.readFileSync(donorPath, 'utf8');

function span(text, tag) {
  const open = text.indexOf('<' + tag + '>');
  if (open < 0) return null;
  const start = open + tag.length + 2;
  let depth = 1;
  const re = new RegExp('<' + tag + '>|</' + tag + '>', 'g');
  re.lastIndex = start;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '<' + tag + '>') depth++;
    else { depth--; if (!depth) return { start, end: m.index, close: m.index }; }
  }
  return null;
}
function splitTop(inner) {
  const els = [];
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt < 0) break;
    if (inner.startsWith('<!--', lt)) { const e = inner.indexOf('-->', lt); i = e < 0 ? inner.length : e + 3; continue; }
    const m = /^<([A-Za-z0-9:]+)/.exec(inner.slice(lt, lt + 60));
    if (!m) { i = lt + 2; continue; }
    const tag = m[1];
    const openEnd = inner.indexOf('>', lt);
    if (openEnd < 0) break;
    let end = openEnd + 1;
    if (inner[openEnd - 1] !== '/') {
      const closeTag = '</' + tag + '>';
      let depth = 1, pos = openEnd + 1;
      while (depth > 0) {
        const no = inner.indexOf('<' + tag + '>', pos);
        const noa = inner.indexOf('<' + tag + ' ', pos);
        const nc = inner.indexOf(closeTag, pos);
        if (nc < 0) { end = inner.length; break; }
        const cand = Math.min(no >= 0 ? no : Infinity, noa >= 0 ? noa : Infinity);
        if (cand < nc) { depth++; pos = cand + tag.length + 2; }
        else { depth--; end = nc + closeTag.length; if (!depth) break; pos = nc + closeTag.length; }
      }
    }
    els.push(inner.slice(lt, end));
    i = end;
  }
  return els;
}

const bSpan = span(base, 'ChildObjects');
const dSpan = span(donor, 'ChildObjects');
if (!bSpan || !dSpan) { console.error('no ChildObjects'); process.exit(3); }
const bKeys = new Set(splitTop(base.slice(bSpan.start, bSpan.end)).map((e) => {
  const k = /^<([A-Za-z0-9:]+)/.exec(e)[1];
  const n = /<Name>([\s\S]*?)<\/Name>/.exec(e);
  return k + ':' + (n ? n[1].trim() : '');
}));
const donorEls = splitTop(donor.slice(dSpan.start, dSpan.end));
const inserts = [];
for (const el of donorEls) {
  const k = /^<([A-Za-z0-9:]+)/.exec(el)[1];
  const n = /<Name>([\s\S]*?)<\/Name>/.exec(el);
  const name = n ? n[1].trim() : null;
  if (!name || k !== 'Attribute' || !names.includes(name)) continue;
  if (bKeys.has(k + ':' + name)) continue;
  inserts.push(el);
}
if (!inserts.length) { console.log(JSON.stringify({ added: 0 })); process.exit(0); }
const block = inserts.map((e) => '\t\t\t' + e.trim() + '\n').join('');
fs.writeFileSync(basePath, base.slice(0, bSpan.close) + block + base.slice(bSpan.close));
console.log(JSON.stringify({ added: inserts.length, names: inserts.map((e) => /<Name>([\s\S]*?)<\/Name>/.exec(e)[1].trim()) }));
