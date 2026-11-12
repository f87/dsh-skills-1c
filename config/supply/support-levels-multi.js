#!/usr/bin/env node
'use strict';
/*
 * support-levels-multi.js — пересчёт уровней поддержки в Ext\ParentConfigurations.bin по правилу «0/1»
 * для ФАЙЛА С НЕСКОЛЬКИМИ ПОСТАВКАМИ: каждая поставка считается против своего дерева и своего
 * ConfigDumpInfo.xml, все поставки — за один прогон.
 *
 * ПРАВИЛО (support-levels.md §1 и §3.1):
 *   - уровень 2 не используем (кроме исключительных случаев);
 *   - объект полностью идентичен поставке d → «0» в записи этой поставки, иначе → «1»;
 *   - каждая запись сравнивается ТОЛЬКО со своей поставкой: уровень главной поставки на записи
 *     второстепенных не переносится. Один и тот же (общий) объект может быть «0» в записи одной
 *     поставки и «1» в записи другой — это и есть его настоящее состояние;
 *   - корень = 0 только если все его дочерние записи 0; если хоть одна ≠ 0 → корень 1;
 *   - то же для табличных частей: изменился реквизит внутри ТЧ → ТЧ 1 → и документ 1.
 *
 * Использование:
 *   node support-levels-multi.js --bin <bin> --ours-root <наше дерево> --hashes-ours <hashes.json> \
 *        --map <map.json> [--json <report>.json] [--json-details <details>.json] \
 *        [--out <new>.bin --write] [--only <ПолноеИмя>] [--allow-unresolved]
 *
 *   map.json — массив по порядку поставок в .bin (пути разрешаются от текущего каталога):
 *   [ { "vendorRoot": "<vendorTree1>", "hashes": "<hashes1>.json", "cdi": "<vendorTree1>/ConfigDumpInfo.xml" },
 *     { "vendorRoot": "<vendorTree2>", "hashes": "<hashes2>.json", "cdi": "<vendorTree2>/ConfigDumpInfo.xml" } ]
 *
 * Коды возврата: 0 — расчёт (и запись) выполнены; 2 — нет обязательного параметра или нет --out при
 *   --write; 3 — в --map не столько элементов, сколько поставок в .bin; 4 — при --write остались записи,
 *   которые не удалось сопоставить с именем (нужен разбор или --allow-unresolved).
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
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}
const A = parseArgs(process.argv.slice(2));
for (const req of ['bin', 'ours-root', 'hashes-ours', 'map']) {
  if (!A[req]) { console.error(`не задан --${req}`); process.exit(2); }
}

function readJson(what, file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`не удалось прочитать ${what} ${file}: ${e.message}`);
    process.exit(2);
  }
}

let bin;
try {
  bin = parseBin(fs.readFileSync(A.bin));
} catch (e) {
  console.error(`не удалось разобрать --bin ${A.bin}: ${e.message}`);
  process.exit(2);
}
const mapSpec = readJson('--map', A.map);
if (!Array.isArray(mapSpec) || mapSpec.length !== bin.count) {
  console.error(`в --map должно быть ${bin.count} элементов (по числу поставок), а в файле ${Array.isArray(mapSpec) ? mapSpec.length : 'не массив'}`);
  process.exit(3);
}

const hO = readJson('--hashes-ours', A['hashes-ours']);
const idxO = index(hO);

// ---------- общие утилиты ----------
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
function normBlock(s) {
  return s.replace(/\r\n/g, '\n').replace(/>\s+</g, '><').trim();
}
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
    // продолжаем сканирование ВНУТРИ блока: у корневого элемента тоже есть uuid
    re.lastIndex = m.index + m[0].length;
  }
  blockCache.set(file, map);
  return map;
}

// ---------- расчёт одной поставки ----------
const namesCache = new Map();
function namesOf(i) {
  if (namesCache.has(i)) return namesCache.get(i);
  const m = new Map();
  const s = fs.readFileSync(mapSpec[i].cdi, 'utf8');
  for (const x of s.matchAll(/<Metadata name="([^"]+)" id="([^"]+)"/g)) m.set(x[2].toLowerCase(), x[1]);
  namesCache.set(i, m);
  return m;
}
const rootsCache = new Map();
function presentRoots(i) {
  if (rootsCache.has(i)) return rootsCache.get(i);
  const h = JSON.parse(fs.readFileSync(mapSpec[i].hashes, 'utf8'));
  const out = new Set();
  for (const k of Object.keys(h)) {
    const p = k.split('/');
    if (p.length > 1) out.add(p[1].replace(/\.xml$/, ''));
  }
  rootsCache.set(i, out);
  return out;
}
const shortRoot = (n) => n.split('.')[1];
function rootNameOf(n) {
  const p = n.split('.');
  if (p[0] === 'Subsystem' && p.length >= 4 && p[2] === 'Subsystem') return p.slice(0, 4).join('.');
  return p.slice(0, 2).join('.');
}

function computeDelivery(d, spec) {
  const hV = JSON.parse(fs.readFileSync(spec.hashes, 'utf8'));
  const idxV = index(hV);
  const cdiText = fs.readFileSync(spec.cdi, 'utf8');
  const uuidToName = new Map();
  for (const m of cdiText.matchAll(/<Metadata name="([^"]+)" id="([^"]+)"/g)) uuidToName.set(m[2].toLowerCase(), m[1]);
  const vendorRoot = spec.vendorRoot;

  function cmpDir(prefix) {
    const a = idxV.get(prefix) || [];
    const b = idxO.get(prefix) || [];
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
    const a = hV[k], b = hO[k];
    if (a === b) return [];
    return [{ k, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed' }];
  }

  const nameToFolders = new Map();
  for (const key of Object.keys(hV)) {
    const m = /^([^/]+)\/([^/]+)\.xml$/.exec(key);
    if (!m) continue;
    if (!nameToFolders.has(m[2])) nameToFolders.set(m[2], new Set());
    nameToFolders.get(m[2]).add(m[1]);
  }
  const rootNameOf = (name) => name.split('.').slice(0, 2).join('.');
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
  for (let k = 0; k < d.objects; k++) before[bin.tokens[d.objStart + 4 * k]]++;

  const rootInfo = new Map();
  for (const r of recs) {
    const root = rootNameOf(r.name);
    if (rootInfo.has(root)) continue;
    const p = pathsOfRoot(root);
    if (!p) { rootInfo.set(root, { changed: true, noPaths: true, p: null, diff: [] }); continue; }
    const diff = cmpFile(p.xml).concat(cmpDir(p.dir));
    rootInfo.set(root, { changed: diff.length > 0, p, diff });
  }

  const changes = [];
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
        const names = parts.filter((_, i) => i % 2 === 1);
        const subXml = `Subsystems/${names.join('/Subsystems/')}.xml`;
        const hasInV = (idxV.get(subXml) || []).length > 0 || hV[subXml] !== undefined;
        const hasInO = (idxO.get(subXml) || []).length > 0 || hO[subXml] !== undefined;
        if (!hasInV && !hasInO) {
          const a0 = loadBlocks(path.join(vendorRoot, st.p.xml)).get(r.uuid.toLowerCase());
          const b0 = loadBlocks(path.join(A['ours-root'], st.p.xml)).get(r.uuid.toLowerCase());
          level = a0 !== undefined && b0 !== undefined && a0 === b0 ? '0' : '1';
        } else level = cmpFile(subXml).concat(cmpDir(subXml.slice(0, -4))).length ? '1' : '0';
      } else if (kind === 'Form') level = cmpDir(`${st.p.base}/Forms/${child}`).length ? '1' : '0';
      else if (kind === 'Template') level = cmpDir(`${st.p.base}/Templates/${child}`).length ? '1' : '0';
      else if (kind === 'Help') level = cmpDir(`${st.p.base}/Ext/Help`).length ? '1' : '0';
      else {
        const a = loadBlocks(path.join(vendorRoot, st.p.xml)).get(r.uuid.toLowerCase());
        const b = loadBlocks(path.join(A['ours-root'], st.p.xml)).get(r.uuid.toLowerCase());
        level = a === b ? '0' : '1';
        if (level === '1') changes.push({ name: r.name, why: a === undefined ? 'нет в вендоре' : b === undefined ? 'нет у нас' : 'блок отличается' });
      }
    }
    newLevels.set(r.base, level);
    after[level]++;
    if (level !== r.cur) changes.push({ name: r.name, from: r.cur, to: level, why: 'уровень' });
  }

  const changedRoots = [];
  for (const [root, st] of rootInfo) {
    if (!st.changed) continue;
    changedRoots.push({ root, files: st.diff ? st.diff.length : 0, sample: st.diff ? st.diff.slice(0, 3).map((x) => x.k) : [] });
  }

  return {
    summary: {
      delivery: { index: d.index, name: d.name, version: d.version, objects: d.objects },
      unresolvedNames: unresolved,
      roots: { changed: rootsChanged, same: rootsSame, noPaths },
      before, after,
      levelChanges: changes.filter((c) => c.why === 'уровень').length,
      blockChanges: changes.filter((c) => c.why !== 'уровень').length,
    },
    changedRoots, changes, newLevels,
  };
}

const results = [];
for (let i = 0; i < bin.count; i++) results.push(computeDelivery(bin.deliveries[i], mapSpec[i]));


// ---------- корень не может быть 0, если хотя бы один дочерний объект 1 ----------
let rootsRaised = 0;
for (let i = 0; i < bin.count; i++) {
  const d = bin.deliveries[i], res = results[i];
  const names = namesOf(i);
  const byRoot = new Map();
  for (let k = 0; k < d.objects; k++) {
    const g = d.objStart + 4 * k;
    const n = names.get(bin.tokens[g + 2].toLowerCase());
    if (!n) continue;
    const r = rootNameOf(n);
    if (!byRoot.has(r)) byRoot.set(r, { rootRec: null, child1: 0 });
    const e = byRoot.get(r);
    if (n === r) e.rootRec = g; else if (res.newLevels.get(g) === '1') e.child1++;
  }
  for (const e of byRoot.values()) {
    if (e.rootRec == null || e.child1 === 0) continue;
    if (res.newLevels.get(e.rootRec) === '0') { res.newLevels.set(e.rootRec, '1'); rootsRaised++; }
  }
}
if (rootsRaised) console.error(`корней поднято до 1 из-за дочерних: ${rootsRaised}`);

// ---------- пересчёт итогов после поднятия корней ----------
for (let i = 0; i < bin.count; i++) {
  const d = bin.deliveries[i], res = results[i];
  const after = { 0: 0, 1: 0, 2: 0 };
  let lvlChanges = 0;
  for (let k = 0; k < d.objects; k++) {
    const g = d.objStart + 4 * k;
    const nw = res.newLevels.get(g);
    after[nw]++;
    if (nw !== bin.tokens[g]) lvlChanges++;
  }
  res.summary.after = after;
  res.summary.levelChanges = lvlChanges;
}

console.log(JSON.stringify(results.map((r) => r.summary), null, 1));
if (A.json) fs.writeFileSync(A.json, JSON.stringify(results.map((r) => r.summary), null, 1));
if (A['json-details']) fs.writeFileSync(A['json-details'], JSON.stringify(results, null, 1));

// ---------- записи, которые не удалось проверить ----------
// Без имени из ConfigDumpInfo запись не с чем сравнить — её уровень остается прежним (может быть 2).
// Без путей в дереве поставки сравнить тоже нечего: ставим 1 (безопасная сторона), но сообщаем.
const unresolvedTotal = results.reduce((s, r) => s + r.summary.unresolvedNames, 0);
const noPathsTotal = results.reduce((s, r) => s + r.summary.roots.noPaths, 0);
if (unresolvedTotal) {
  console.error(`ВНИМАНИЕ: ${unresolvedTotal} записей без имени в ConfigDumpInfo — их уровни не пересчитаны`);
}
if (noPathsTotal) {
  console.error(`ВНИМАНИЕ: ${noPathsTotal} записей без путей в дереве своей поставки — им поставлен 1`);
}

if (A.write) {
  if (!A.out) { console.error('для --write нужен --out'); process.exit(2); }
  if (unresolvedTotal && !A['allow-unresolved']) {
    console.error(`запись отменена: ${unresolvedTotal} записей не сопоставлены с именем. ` +
      'Разберите их (--only / ConfigDumpInfo) или повторите с --allow-unresolved, приняв, что их уровни не проверены');
    process.exit(4);
  }
  const tokens = bin.tokens.slice();
  for (const r of results) for (const [i, lvl] of r.newLevels) tokens[i] = lvl;
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(tokens.join(','), 'utf8')]);
  const chk = parseBin(buf);
  if (chk.count !== bin.count) throw new Error('счётчик поставок изменился');
  for (let i = 0; i < bin.count; i++) {
    const da = bin.deliveries[i], db = chk.deliveries[i];
    if (da.objects !== db.objects) throw new Error(`поставка ${i}: счётчик объектов изменился`);
    for (let k = 0; k < da.objects; k++) {
      const a = da.objStart + 4 * k, b = db.objStart + 4 * k;
      for (let j = 1; j < 4; j++) if (bin.tokens[a + j] !== chk.tokens[b + j]) throw new Error(`изменился не уровень: поставка ${i}, запись ${k}, токен ${j}`);
    }
  }
  fs.writeFileSync(A.out, buf);
  console.log(`записан ${A.out}: ${buf.length} Б, SHA1 ${crypto.createHash('sha1').update(buf).digest('hex').toUpperCase()}`);
}
