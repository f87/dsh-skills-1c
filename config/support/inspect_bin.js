#!/usr/bin/env node
'use strict';
/*
 * inspect_bin.js — разбор Ext\ParentConfigurations.bin (XML-выгрузка 1С 8.3).
 * Только чтение. Печатает структуру: заголовок, поставки, записи объектов, служебный хвост.
 *
 * Использование: node inspect_bin.js <ParentConfigurations.bin> [<ConfigDumpInfo.xml>]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- токенизация: запятая вне кавычек; кавычка внутри значения удваивается ----
function tokenize(text) {
  const tokens = [];
  let sb = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; sb += ch; continue; }
    if (ch === ',' && !inQuotes) { tokens.push(sb); sb = ''; continue; }
    sb += ch;
  }
  tokens.push(sb);
  return tokens;
}
function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1);
  return s.split('""').join('"');
}

function parseBin(buf) {
  const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const body = hasBom ? buf.slice(3) : buf;
  const text = body.toString('utf8');
  const roundTrip = Buffer.from(text, 'utf8');
  const tokens = tokenize(text);
  const reserialized = tokens.join(',');
  const deliveries = [];
  const count = parseInt(tokens[2], 10);
  let pos = 3;
  for (let i = 0; i < count; i++) {
    const objects = parseInt(tokens[pos + 6], 10);
    deliveries.push({
      index: i,
      start: pos,
      flagIndex: pos + 1,
      countIndex: pos + 6,
      objStart: pos + 7,
      objects,
      flag: parseInt(tokens[pos + 1], 10),
      guid: tokens[pos + 2],
      version: unquote(tokens[pos + 3]),
      vendor: unquote(tokens[pos + 4]),
      name: unquote(tokens[pos + 5]),
      end: pos + 9 + 4 * objects, // индекс первого токена следующего блока / хвоста
    });
    pos = pos + 9 + 4 * objects;
  }
  return {
    buf, hasBom, text, tokens, count, deliveries,
    headerFlag: parseInt(tokens[1], 10),
    supportGuid: tokens[3],
    tail: tokens.slice(pos),
    tailStart: pos,
    utf8BytesOk: Buffer.compare(roundTrip, body) === 0,
    reserializeOk: reserialized === text,
    sha1: crypto.createHash('sha1').update(buf).digest('hex'),
  };
}

function names(mapPath) {
  const map = new Map();
  if (!mapPath || !fs.existsSync(mapPath)) return map;
  const xml = fs.readFileSync(mapPath, 'utf8');
  const tagRe = /<Metadata\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const idM = / id="([^"]+)"/.exec(m[0]);
    const nameM = / name="([^"]*)"/.exec(m[0]);
    if (idM && nameM) map.set(idM[1], nameM[1]);
  }
  return map;
}

function main() {
  const file = process.argv[2];
  const dci = process.argv[3];
  if (!file) { console.error('usage: node inspect_bin.js <bin> [ConfigDumpInfo.xml]'); process.exit(2); }
  const info = parseBin(fs.readFileSync(file));
  const nm = names(dci);
  const out = [];
  const say = (s) => out.push(s);

  say(`file: ${file}`);
  say(`bytes: ${info.buf.length}; BOM: ${info.hasBom}; SHA1: ${info.sha1}`);
  say(`utf8 round-trip ok: ${info.utf8BytesOk}; tokens.join(',') === text: ${info.reserializeOk}`);
  say(`tokens: ${info.tokens.length}; text chars: ${info.text.length}`);
  say(`header: token0=${JSON.stringify(info.tokens[0])} flag=${info.headerFlag} deliveries=${info.count} supportGuid=${info.supportGuid}`);
  say(`CR count: ${(info.text.match(/\r/g) || []).length}; LF count: ${(info.text.match(/\n/g) || []).length}; last char: ${JSON.stringify(info.text.slice(-1))}`);
  info.deliveries.forEach(d => {
    say(`delivery ${d.index}: start=${d.start} flagIndex=${d.flagIndex} flag=${d.flag} countIndex=${d.countIndex} objects=${d.objects} objStart=${d.objStart} end(exclusive)=${d.end}`);
    say(`  guid=${d.guid} version="${d.version}" vendor="${d.vendor}" name="${d.name}"`);
    const lvl = {};
    for (let k = 0; k < d.objects; k++) {
      const g = d.objStart + 4 * k;
      const L = info.tokens[g];
      lvl[L] = (lvl[L] || 0) + 1;
    }
    say(`  levels: ${Object.keys(lvl).sort().map(k => `${k}=${lvl[k]}`).join(' ')}`);
    // первые 3 записи как пример
    for (let k = 0; k < Math.min(3, d.objects); k++) {
      const g = d.objStart + 4 * k;
      const uuid = info.tokens[g + 2];
      say(`  obj[${k}] @${g}: ${info.tokens.slice(g, g + 4).join(',')}  # ${nm.get(uuid) || '<нет в ConfigDumpInfo>'}`);
    }
    for (let k = 0; k < d.objects; k++) {
      const g = d.objStart + 4 * k;
      if (info.tokens[g + 2] !== info.tokens[g + 3]) {
        say(`  self-uuid differs first at obj[${k}]: ${info.tokens[g + 2]} vs ${info.tokens[g + 3]}`);
        break;
      }
    }
  });
  say(`tailStart=${info.tailStart}; tailTokens=${info.tail.length}`);
  say(`tail: ${JSON.stringify(info.tail)}`);
  say(`token before tail: ${JSON.stringify(info.tokens[info.tailStart - 1])}`);
  const quoted = info.tokens.map((t, i) => ({ i, t })).filter(x => x.t.includes('"'));
  say(`tokens containing a quote: ${quoted.length}`);
  quoted.slice(0, 12).forEach(x => say(`  [${x.i}] ${JSON.stringify(x.t)}`));
  console.log(out.join('\n'));
}

if (require.main === module) main();
module.exports = { tokenize, unquote, parseBin };
