#!/usr/bin/env node
'use strict';
/*
 * support-levels.js — расчёт уровней поддержки 0/1 в Ext\ParentConfigurations.bin.
 *
 * ПРАВИЛО (проверено 28.10.2026, платформа 8.3.27.1859):
 *   - уровень 2 не используем (кроме исключительных случаев по указанию владельца);
 *   - объект полностью идентичен поставке -> 0, иначе -> 1;
 *   - корень = 0 только если все его дочерние записи 0; если хоть одна != 0 -> корень 1;
 *   - то же для табличных частей: изменился реквизит внутри ТЧ -> ТЧ 1 -> и документ 1.
 *
 * Сравниваются файловые наборы дерева поставки и нашего дерева (через манифесты
 * хэшей size:sha1); для дочерних записей (реквизиты, ТЧ, команды) определения лежат
 * внутри XML корневого объекта — сравниваются блоки по uuid.
 * Служебные файлы поддержки (ConfigDumpInfo.xml, Ext\ParentConfigurations*) не сравниваются.
 *
 * Использование:
 *   node support-levels.js --bin <bin> --cdi <ConfigDumpInfo.xml> \
 *        --vendor-root <дерево поставки> --ours-root <наше дерево> \
 *        --hashes-vendor <vendor.json> --hashes-ours <ours.json> \
 *        [--delivery <номер|имя>] [--only <ПолноеИмя>] [--json <report.json>] \
 *        [--out <new.bin> --write]
 *
 * Коды возврата: 0 — успех; 2 — параметры; 3 — выбор поставки.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseBin } = require('../support/inspect_bin.js');

function parseArgs(argv) {
  const out = { write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else { console.error(`лишний аргумент: ${a}`); process.exit(2); }
  }
  return out;
}

const USAGE = `usage: node support-levels.js --bin <bin> --cdi <ConfigDumpInfo.xml>
       --vendor-root <vendorTree> --ours-root <tree>
       --hashes-vendor <vendor.json> --hashes-ours <ours.json>
       [--delivery <номер|имя>] [--only <ПолноеИмя>] [--json <report.json>]
       [--out <new.bin> --write]`;

const A = parseArgs(process.argv.slice(2));
if (A.help) { console.log(USAGE); process.exit(0); }
if (!A.bin) { console.error(USAGE); process.exit(2); }
for (const req of ['cdi', 'vendor-root', 'ours-root', 'hashes-vendor', 'hashes-ours']) {
  if (!A[req]) { console.error(`не задан --${req}\n${USAGE}`); process.exit(2); }
}
if (A.write && !A.out) { console.error('для --write нужен --out'); process.exit(2); }
if (A.write && A.only) { console.error('--only — только для отчёта, с --write не сочетается'); process.exit(2); }

const binBuf = fs.readFileSync(A.bin);
const bin = parseBin(binBuf);
if (bin.count < 1) { console.error('в .bin нет поставок'); process.exit(3); }

// ---------- выбор поставки ----------
let di = 0;
if (A.delivery !== undefined) {
  const v = String(A.delivery);
  if (/^\d+$/.test(v)) {
    di = parseInt(v, 10);
    if (di >= bin.count) {
      console.error(`в .bin ${bin.count} поставк(и), --delivery ${di} вне диапазона (0..${bin.count - 1})`);
      process.exit(3);
    }
  } else {
    const want = v.toLowerCase();
    const found = bin.deliveries.find((x) => x.name.toLowerCase() === want);
    if (!found) {
      console.error(`поставка "${v}" не найдена; в .bin: ${bin.deliveries.map((x) => `${x.index}:${x.name}`).join(', ')}`);
      process.exit(3);
    }
    di = found.index;
  }
} else if (bin.count > 1) {
  console.error(`в .bin ${bin.count} поставки — укажите --delivery\n` +
    bin.deliveries.map((x) => `  ${x.index}: ${x.name} ${x.version}`).join('\n'));
  process.exit(3);
}
const d = bin.deliveries[di];

const cdiText = fs.readFileSync(A.cdi, 'utf8');
const uuidToName = new Map();
for (const m of cdiText.matchAll(/<Metadata name="([^"]+)" id="([^"]+)"/g)) uuidToName.set(m[2].toLowerCase(), m[1]);

const hV = JSON.parse(fs.readFileSync(A['hashes-vendor'], 'utf8'));
const hO = JSON.parse(fs.readFileSync(A['hashes-ours'], 'utf8'));

// ---------- служебные файлы поддержки не сравниваем ----------
const SERVICE = new Set(['configdumpinfo.xml', 'ext/parentconfigurations.bin']);
function isService(key) {
  const k = key.toLowerCase();
  return SERVICE.has(k) || k.startsWith('ext/parentconfigurations/');
}

// ---------- индексы: каталог -> ключи ----------
function index(h) {
  const m = new Map();
  for (const key of Object.keys(h)) {
    const parts = key.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!m.has(p)) m.set(p, []);
      m.get(p).push(key);
    }
  }
  return m;
}
const idxV = index(hV), idxO = index(hO);

function cmpDir(prefix) {
  const a = (idxV.get(prefix) || []).filter((k) => !isService(k));
  const b = (idxO.get(prefix) || []).filter((k) => !isService(k));
  const out = [];
  const setB = new Set(b);
  for (const k of a) {
    if (!setB.has(k)) out.push({ k, kind: 'removed' });
    else if (hV[k] !== hO[k]) out.push({ k, kind: 'changed' });
  }
  const setA = new Set(a);
  for (const k of b) if (!setA.has(k)) out.push({ k, kind: 'added' });
  return out;
}
function cmpFile(k) {
  if (isService(k)) return [];
  const a = hV[k], b = hO[k];
  if (a === b) return [];
  return [{ k, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed' }];
}

// ---------- имя объекта -> каталог выгрузки ----------
const nameToFolders = new Map();
for (const key of Object.keys(hV)) {
  const m = /^([^/]+)\/([^/]+)\.xml$/.exec(key);
  if (!m) continue;
  if (!nameToFolders.has(m[2])) nameToFolders.set(m[2], new Set());
  nameToFolders.get(m[2]).add(m[1]);
}
function rootNameOf(name) {
  const parts = name.split('.');
  return parts.slice(0, 2).join('.');
}
const typeVotes = new Map();
for (let k = 0; k < d.objects; k++) {
  const uuid = bin.tokens[d.objStart + 4 * k + 2].toLowerCase();
  const nm = uuidToName.get(uuid);
  if (!nm || nm.split('.').length < 2) continue;
  const root = rootNameOf(nm);
  const type = root.slice(0, root.indexOf('.'));
  const objName = root.slice(root.indexOf('.') + 1);
  const cands = nameToFolders.get(objName);
  if (!cands) continue;
  if (!typeVotes.has(type)) typeVotes.set(type, new Map());
  const v = typeVotes.get(type);
  for (const f of cands) v.set(f, (v.get(f) || 0) + 1);
}
const typeFolder = new Map();
for (const [type, votes] of typeVotes) {
  let best = null, bestN = -1;
  for (const [f, n] of votes) if (n > bestN) { best = f; bestN = n; }
  typeFolder.set(type, best);
}
function pathsOfRoot(root) {
  const i = root.indexOf('.');
  const type = root.slice(0, i), name = root.slice(i + 1);
  if (type === 'Configuration') return { base: '.', xml: 'Configuration.xml', dir: 'Ext' };
  const folder = typeFolder.get(type);
  if (!folder) return null;
  return { base: `${folder}/${name}`, xml: `${folder}/${name}.xml`, dir: `${folder}/${name}` };
}

// ---------- блоки XML по uuid ----------
const blockCache = new Map();
function loadBlocks(file) {
  if (blockCache.has(file)) return blockCache.get(file);
  let xml = '';
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) { xml = ''; }
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const map = new Map();
  const re = /<([A-Za-z][A-Za-z0-9_]*)\b[^>]*?\buuid="([0-9a-fA-F-]{36})"/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[1], uuid = m[2].toLowerCase();
    const close = `</${tag}>`;
    const end = xml.indexOf(close, re.lastIndex);
    if (end < 0) continue;
    if (!map.has(uuid)) map.set(uuid, normBlock(xml.slice(m.index, end + close.length)));
    // продолжаем сканирование ВНУТРИ блока: у корневого элемента тоже есть uuid,
    // и его блок накрывает весь файл
    re.lastIndex = m.index + m[0].length;
  }
  blockCache.set(file, map);
  return map;
}
function normBlock(s) {
  return s.replace(/\r\n/g, '\n').replace(/>\s+</g, '><').trim();
}

// ---------- обход записей выбранной поставки ----------
const only = A.only || null;
const recs = [];
let unresolved = 0;
for (let k = 0; k < d.objects; k++) {
  const base = d.objStart + 4 * k;
  const uuid = bin.tokens[base + 2];
  const name = uuidToName.get(uuid.toLowerCase()) || null;
  if (!name) { unresolved++; continue; }
  if (only && !name.startsWith(only)) continue;
  recs.push({ base, uuid, name, cur: bin.tokens[base] });
}

const before = { 0: 0, 1: 0, 2: 0 };
for (const r of recs) before[r.cur] = (before[r.cur] || 0) + 1;

const rootInfo = new Map();
for (const r of recs) {
  const root = rootNameOf(r.name);
  if (rootInfo.has(root)) continue;
  const p = pathsOfRoot(root);
  if (!p) { rootInfo.set(root, { changed: true, noPaths: true, p: null, diff: [] }); continue; }
  const diff = cmpFile(p.xml).concat(cmpDir(p.dir));
  rootInfo.set(root, { changed: diff.length > 0, p, diff });
}

const report = { changes: [] };
const after = { 0: 0, 1: 0, 2: 0 };
const newLevels = new Map();
let rootsChanged = 0, rootsSame = 0, noPaths = 0;
for (const st of rootInfo.values()) {
  if (st.noPaths) { noPaths++; continue; }
  if (st.changed) rootsChanged++; else rootsSame++;
}

for (const r of recs) {
  const root = rootNameOf(r.name);
  const st = rootInfo.get(root);
  let level;
  if (!st.p) level = '1';
  else if (!st.changed) level = '0';
  else if (r.name === root) level = '1';
  else {
    const parts = r.name.split('.');
    const kind = parts[2], child = parts[3];
    if (kind === 'Subsystem') {
      // вложенные подсистемы лежат отдельными файлами: Subsystems/A/Subsystems/B.xml
      const names = parts.filter((_, i) => i % 2 === 1);
      const subXml = `Subsystems/${names.join('/Subsystems/')}.xml`;
      const hasInV = (idxV.get(subXml) || []).length > 0 || hV[subXml] !== undefined;
      const hasInO = (idxO.get(subXml) || []).length > 0 || hO[subXml] !== undefined;
      if (!hasInV && !hasInO) {
        if (!st.p) level = '1';
        else {
          const a0 = loadBlocks(path.join(A['vendor-root'], st.p.xml)).get(r.uuid.toLowerCase());
          const b0 = loadBlocks(path.join(A['ours-root'], st.p.xml)).get(r.uuid.toLowerCase());
          level = a0 !== undefined && b0 !== undefined && a0 === b0 ? '0' : '1';
        }
      } else level = cmpFile(subXml).concat(cmpDir(subXml.slice(0, -4))).length ? '1' : '0';
    } else if (kind === 'Form') level = cmpDir(`${st.p.base}/Forms/${child}`).length ? '1' : '0';
    else if (kind === 'Template') level = cmpDir(`${st.p.base}/Templates/${child}`).length ? '1' : '0';
    else if (kind === 'Help') level = cmpDir(`${st.p.base}/Ext/Help`).length ? '1' : '0';
    else {
      const a = loadBlocks(path.join(A['vendor-root'], st.p.xml)).get(r.uuid.toLowerCase());
      const b = loadBlocks(path.join(A['ours-root'], st.p.xml)).get(r.uuid.toLowerCase());
      if (a === undefined && b === undefined) level = '1';
      else if (a === undefined || b === undefined) level = '1';
      else level = a === b ? '0' : '1';
      if (level === '1') report.changes.push({ name: r.name, why: a === undefined ? 'нет в вендоре' : b === undefined ? 'нет у нас' : 'блок отличается' });
    }
  }
  newLevels.set(r.base, level);
  after[level]++;
  if (level !== r.cur) report.changes.push({ name: r.name, from: r.cur, to: level, why: 'уровень' });
}

const summary = {
  bin: A.bin,
  deliveriesTotal: bin.count,
  delivery: { index: d.index, name: d.name, version: d.version, objects: d.objects },
  recordsSelected: recs.length,
  unresolvedNames: unresolved,
  roots: { changed: rootsChanged, same: rootsSame, noPaths },
  before, after,
  levelChanges: report.changes.filter((c) => c.why === 'уровень').length,
  blockChanges: report.changes.filter((c) => c.why !== 'уровень').length,
};
console.log(JSON.stringify(summary, null, 1));

if (A.json) {
  const changedRoots = [];
  for (const [root, st] of rootInfo) {
    if (!st.changed) continue;
    changedRoots.push({ root, files: st.diff ? st.diff.length : 0, sample: st.diff ? st.diff.slice(0, 3).map((x) => x.k) : [] });
  }
  fs.writeFileSync(A.json, JSON.stringify({ summary, changedRoots, changes: report.changes }, null, 1));
}
if (only) for (const r of recs) console.log(`${r.name}  ${r.cur} -> ${newLevels.get(r.base)}`);

if (A.write) {
  const tokens = bin.tokens.slice();
  for (const [i, lvl] of newLevels) tokens[i] = lvl;
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(tokens.join(','), 'utf8')]);
  const chk = parseBin(buf);
  if (chk.count !== bin.count) throw new Error(`изменилось число поставок: ${bin.count} -> ${chk.count}`);
  for (let i = 0; i < bin.count; i++) {
    if (chk.deliveries[i].objects !== bin.deliveries[i].objects) throw new Error(`изменилось число записей поставки ${i}`);
  }
  const levelIdx = new Set(newLevels.keys());
  for (let i = 0; i < tokens.length; i++) {
    if (!levelIdx.has(i) && tokens[i] !== bin.tokens[i]) throw new Error(`изменился не уровень: токен ${i}`);
  }
  fs.writeFileSync(A.out, buf);
  console.log(`записан ${A.out}: ${buf.length} Б, SHA1 ${crypto.createHash('sha1').update(buf).digest('hex').toUpperCase()}`);
}
