// PDF → текст: FlateDecode-потоки + ToUnicode CMap + Tj/TJ.
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const outFile = process.argv[3];
const buf = fs.readFileSync(file);
const s = buf.toString('latin1');

let inflated = [];
let idx = 0;
while (true) {
  const a = s.indexOf('stream', idx);
  if (a < 0) break;
  let start = a + 6;
  if (s[start] === '\r') start++;
  if (s[start] === '\n') start++;
  const b = s.indexOf('endstream', start);
  if (b < 0) break;
  const chunk = buf.subarray(start, b);
  idx = b + 9;
  let data = null;
  try { data = zlib.inflateSync(chunk); }
  catch (e) { try { data = zlib.inflateRawSync(chunk); } catch (e2) { continue; } }
  inflated.push(data.toString('latin1'));
}

// --- ToUnicode ---
const cmap = new Map();
for (const st of inflated) {
  if (!st.includes('beginbfchar') && !st.includes('beginbfrange')) continue;
  let m;
  const charRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
  const charBlocks = st.match(/beginbfchar([\s\S]*?)endbfchar/g) || [];
  for (const blk of charBlocks) {
    while ((m = charRe.exec(blk)) !== null) {
      const code = parseInt(m[1], 16);
      const uni = m[2];
      let str = '';
      for (let i = 0; i + 4 <= uni.length; i += 4) str += String.fromCharCode(parseInt(uni.substr(i, 4), 16));
      if (!cmap.has(code)) cmap.set(code, str);
    }
  }
  const rangeBlocks = st.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
  for (const blk of rangeBlocks) {
    const rre = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    while ((m = rre.exec(blk)) !== null) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
      for (let c = lo; c <= hi && c - lo < 512; c++) if (!cmap.has(c)) cmap.set(c, String.fromCharCode(dst + (c - lo)));
    }
  }
}

function decodeHex(hex) {
  let out = '';
  const h = hex.replace(/\s+/g, '');
  for (let i = 0; i + 4 <= h.length; i += 4) {
    const code = parseInt(h.substr(i, 4), 16);
    out += cmap.has(code) ? cmap.get(code) : '\uFFFD';
  }
  return out;
}

const lines = [];
for (const st of inflated) {
  const re = /\[((?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj/g;
  let m, cur = '';
  while ((m = re.exec(st)) !== null) {
    if (m[1] !== undefined) {
      const parts = m[1].match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>/g) || [];
      for (const p of parts) {
        if (p[0] === '<') cur += decodeHex(p.slice(1, -1));
        else cur += p.slice(1, -1).replace(/\\([()\\])/g, '$1');
      }
    } else if (m[2] !== undefined) {
      cur += m[2].replace(/\\([()\\])/g, '$1');
    } else if (m[3] !== undefined) {
      cur += decodeHex(m[3]);
    }
    if (cur.length > 0 && /[.!?:]$/.test(cur.trim())) { lines.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) lines.push(cur.trim());
}

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log('cmap:', cmap.size, 'lines:', lines.length, 'file:', outFile);
