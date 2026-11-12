#!/usr/bin/env node
'use strict';
/*
 * bin_diff.js — структурное сравнение двух Ext\ParentConfigurations.bin (любое число поставок).
 *
 *   node bin_diff.js <a.bin> <b.bin> [--verbose]
 *
 * Сравнивает: флаг конфигурации, число поставок, guid поддержки, хвост; по каждой поставке
 * (сопоставление по имени поставки, иначе по порядку) — parentGuid, флаг, guid, версию, вендора,
 * число записей и сами записи (uuid → уровень/режим).
 * Коды возврата: 0 — структурно идентично, 1 — есть отличия, 2 — ошибка чтения/аргументов.
 */
const fs = require('fs');
const path = require('path');
const { parseBin } = require(path.join(__dirname, '..', 'support', 'inspect_bin.js'));

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const verbose = process.argv.includes('--verbose');
if (args.length < 2) { console.error('usage: node bin_diff.js <a.bin> <b.bin> [--verbose]'); process.exit(2); }

function load(p) {
  const b = parseBin(fs.readFileSync(p));
  b.label = p;
  b.maps = b.deliveries.map((d) => {
    const m = new Map();
    for (let k = 0; k < d.objects; k++) {
      const g = d.objStart + 4 * k;
      m.set(b.tokens[g + 2].toLowerCase(), { lvl: b.tokens[g], mode: b.tokens[g + 1], inD: b.tokens[g + 3] });
    }
    return m;
  });
  return b;
}

let A, B;
try { A = load(args[0]); B = load(args[1]); } catch (e) { console.error('ОШИБКА чтения: ' + e.message); process.exit(2); }

const out = [];
let diffs = 0;
const say = (s) => { out.push(s); if (!verbose) console.log(s); };
const diff = (s) => { diffs++; say('  ОТЛИЧИЕ: ' + s); };

say(`A: ${args[0]}  (${A.buf.length} Б, SHA1 ${A.sha1})`);
say(`B: ${args[1]}  (${B.buf.length} Б, SHA1 ${B.sha1})`);
say(`A: флаг ${A.headerFlag}, поставок ${A.count}, guid поддержки ${A.supportGuid}, хвост ${A.tail.length} токенов`);
say(`B: флаг ${B.headerFlag}, поставок ${B.count}, guid поддержки ${B.supportGuid}, хвост ${B.tail.length} токенов`);
if (A.headerFlag !== B.headerFlag) diff(`флаг конфигурации ${A.headerFlag} != ${B.headerFlag}`);
if (A.count !== B.count) diff(`число поставок ${A.count} != ${B.count}`);
if (A.supportGuid !== B.supportGuid) diff(`guid поддержки ${A.supportGuid} != ${B.supportGuid}`);
if (A.tail.join(',') !== B.tail.join(',')) diff(`хвост:\n      A: ${JSON.stringify(A.tail)}\n      B: ${JSON.stringify(B.tail)}`);

// сопоставление поставок: сначала по имени, иначе по порядку
function matchDeliveries() {
  const pairs = [];
  const usedB = new Set();
  for (let i = 0; i < A.deliveries.length; i++) {
    const d = A.deliveries[i];
    let j = B.deliveries.findIndex((e, k) => !usedB.has(k) && e.name === d.name);
    if (j === -1 && i < B.deliveries.length && !usedB.has(i)) j = i;
    if (j === -1) { pairs.push([i, -1]); continue; }
    usedB.add(j);
    pairs.push([i, j]);
  }
  for (let j = 0; j < B.deliveries.length; j++) if (!usedB.has(j)) pairs.push([-1, j]);
  return pairs;
}

for (const [i, j] of matchDeliveries()) {
  const da = i >= 0 ? A.deliveries[i] : null;
  const db = j >= 0 ? B.deliveries[j] : null;
  if (!da || !db) { diff(`поставка есть только с одной стороны: A[${i}] B[${j}]`); continue; }
  say(`поставка A[${i}] ~ B[${j}]: «${da.name}» ${da.version} / ${da.vendor}`);
  const fields = [
    ['parentGuid', A.tokens[da.start], B.tokens[db.start]],
    ['флаг', String(da.flag), String(db.flag)],
    ['guid', da.guid, db.guid],
    ['версия', da.version, db.version],
    ['вендор', da.vendor, db.vendor],
    ['имя', da.name, db.name],
    ['записей', String(da.objects), String(db.objects)],
  ];
  for (const [n, x, y] of fields) if (x !== y) diff(`поставка[${j}] ${n}: ${x} != ${y}`);
  const ma = A.maps[i], mb = B.maps[j];
  let onlyA = 0, onlyB = 0, lvl = 0, mode = 0, inD = 0;
  const samples = { onlyA: [], onlyB: [], lvl: [], mode: [], inDelivery: [] };
  for (const [u, v] of ma) {
    const w = mb.get(u);
    if (!w) { onlyA++; if (samples.onlyA.length < 5) samples.onlyA.push(u); continue; }
    if (v.lvl !== w.lvl) { lvl++; if (samples.lvl.length < 5) samples.lvl.push(`${u} ${v.lvl}->${w.lvl}`); }
    if (v.mode !== w.mode) { mode++; if (samples.mode.length < 5) samples.mode.push(`${u} ${v.mode}->${w.mode}`); }
    if (v.inD !== w.inD) { inD++; if (samples.inDelivery.length < 5) samples.inDelivery.push(`${u} ${v.inD}->${w.inD}`); }
  }
  for (const u of mb.keys()) if (!ma.has(u)) { onlyB++; if (samples.onlyB.length < 5) samples.onlyB.push(u); }
  say(`  записей: только A ${onlyA}, только B ${onlyB}, уровень изменён ${lvl}, режим изменён ${mode}, uuid в поставке изменён ${inD}`);
  for (const [n, arr] of Object.entries(samples)) if (arr.length) say(`  примеры ${n}: ${arr.join(', ')}`);
  if (onlyA || onlyB || lvl || mode || inD) diffs++;
}

say(diffs === 0 ? 'ИТОГ: структурно идентично' : `ИТОГ: отличий ${diffs}`);
process.exit(diffs === 0 ? 0 : 1);
