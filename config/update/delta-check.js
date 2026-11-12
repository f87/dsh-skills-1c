// Инвариант дельты: перечень доработок до и после обновления должен совпадать.
//
// Использование:
//   node config/update/delta-check.js <beforeTree> <afterTree> <vendorTree> [<vendorTree2> ...] [--json <out.json>]
//
// Что считается «доработкой» (расхождением с поставкой):
//   объект метаданных верхнего уровня, хотя бы один файл которого отличается от версии поставщика
//   (или который в поставке отсутствует — это собственный объект).
//
// Категории результата:
//   preserved      — доработан до и после (норма)
//   lost           — доработан до, но после совпал с поставкой  => ПОТЕРЯ ДОРАБОТКИ (нарушение)
//   new            — не доработан до, но доработан после        => РОСТ РАСХОЖДЕНИЯ (нарушение)
//   removed        — был в дереве «до», исчез из «после»         => допустимо только с записью в отчёте
//   ownAdded       — собственный объект появился                 => нарушение инварианта
//   ownRemoved     — собственный объект исчез                    => нарушение инварианта
//
// Код возврата: 0 — инвариант соблюдён; 1 — нарушения (lost/new/own*); 2 — только removed (нужен отчёт).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = process.argv.slice(2);
let jsonOut = null;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') { jsonOut = argv[++i]; continue; }
  pos.push(argv[i]);
}
const [beforeTree, afterTree, ...vendorTrees] = pos;
if (!beforeTree || !afterTree || !vendorTrees.length) {
  console.error('usage: node config/update/delta-check.js <beforeTree> <afterTree> <vendorTree> [<vendorTree2> ...] [--json <out.json>]');
  process.exit(64);
}

function die(msg) { console.error(msg); process.exit(66); }
for (const t of [beforeTree, afterTree, ...vendorTrees]) {
  if (!fs.existsSync(t)) die('нет каталога: ' + t);
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// uuid -> имя объекта; берём только верхний уровень (two-part names) и Configuration.<Имя>
function readManifest(tree) {
  const f = path.join(tree, 'ConfigDumpInfo.xml');
  if (!fs.existsSync(f)) die('нет ConfigDumpInfo.xml: ' + f);
  const s = fs.readFileSync(f, 'utf8');
  const names = new Set();
  const re = /<Metadata\s+([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const nm = /name="([^"]*)"/.exec(m[1]);
    if (!nm) continue;
    const name = nm[1];
    const parts = name.split('.');
    if (parts.length === 2) names.add(name);
  }
  return names;
}

// тег корневого элемента -> каталог (Catalogs, Documents, ...)
function buildDirMap(tree) {
  const map = Object.create(null);
  for (const e of fs.readdirSync(tree, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(tree, e.name);
    let sample = null;
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.xml')) { sample = path.join(dir, f); break; }
    }
    if (!sample) continue;
    const head = fs.readFileSync(sample, 'utf8').slice(0, 4000);
    const m = /<([A-Za-z][A-Za-z0-9]*)\s+uuid=/.exec(head);
    if (m && !map[m[1]]) map[m[1]] = e.name;
  }
  return map;
}

function objectFiles(tree, dirMap, name) {
  const parts = name.split('.');
  if (parts[0] === 'Configuration') return ['Configuration.xml'];
  const dir = dirMap[parts[0]];
  if (!dir) return [];
  const base = path.join(tree, dir);
  const short = parts[1];
  const files = [];
  const xml = path.join(base, short + '.xml');
  if (fs.existsSync(xml)) files.push(path.join(dir, short + '.xml'));
  const sub = path.join(base, short);
  if (fs.existsSync(sub)) {
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(full, r);
        else if (e.isFile()) files.push(path.join(dir, short, r));
      }
    };
    walk(sub, '');
  }
  return files;
}

// отпечаток объекта: SHA1 по «путь|sha1 файла», отсортированным путям
function objectHash(tree, dirMap, name, cache) {
  if (cache[name] !== undefined) return cache[name];
  const files = objectFiles(tree, dirMap, name);
  if (!files.length) { cache[name] = null; return null; }
  const parts = [];
  for (const rel of files) {
    const full = path.join(tree, rel);
    let buf;
    try { buf = fs.readFileSync(full); } catch (e) { buf = Buffer.from('ERR:' + e.code); }
    parts.push(rel.replace(/\\/g, '/') + '|' + sha1(buf));
  }
  parts.sort();
  cache[name] = sha1(Buffer.from(parts.join('\n')));
  return cache[name];
}

const beforeNames = readManifest(beforeTree);
const afterNames = readManifest(afterTree);
const dirMap = buildDirMap(vendorTrees[0]);
for (const v of vendorTrees.slice(1)) {
  const m = buildDirMap(v);
  for (const k of Object.keys(m)) if (!dirMap[k]) dirMap[k] = m[k];
}
const vendorCaches = vendorTrees.map(() => Object.create(null));
const beforeCache = Object.create(null);
const afterCache = Object.create(null);

function vendorHashes(name) {
  const out = [];
  vendorTrees.forEach((v, i) => {
    const h = objectHash(v, dirMap, name, vendorCaches[i]);
    if (h) out.push(h);
  });
  return out;
}

function classify(name, tree, cache) {
  const h = objectHash(tree, dirMap, name, cache);
  if (h === null) return 'absent';
  const vs = vendorHashes(name);
  if (!vs.length) return 'own';
  return vs.includes(h) ? 'vendor' : 'modified';
}

const result = { preserved: [], lost: [], new: [], removed: [], ownAdded: [], ownRemoved: [] };
const allNames = new Set([...beforeNames, ...afterNames]);

for (const name of [...allNames].sort()) {
  const b = beforeNames.has(name) ? classify(name, beforeTree, beforeCache) : 'absent';
  const a = afterNames.has(name) ? classify(name, afterTree, afterCache) : 'absent';

  if (b === 'absent' && a === 'absent') continue;
  if (b !== 'absent' && a === 'absent') {
    if (b === 'own') result.ownRemoved.push(name);
    else result.removed.push(name);
    continue;
  }
  if (b === 'absent' && a !== 'absent') {
    if (a === 'own') result.ownAdded.push(name);
    else if (a === 'modified') result.new.push(name);
    continue;
  }
  if (b === 'own' || a === 'own') {
    if (b === 'own' && a === 'own') continue;                       // наш объект остался нашим — норма
    if (b !== 'own' && a === 'own') { result.ownAdded.push(name); continue; }   // объект поставки стал «своим»
    result.ownRemoved.push(name); continue;                        // наш объект теперь есть в поставке
  }
  if (b === 'modified' && a === 'modified') { result.preserved.push(name); continue; }
  if (b === 'modified' && a === 'vendor') { result.lost.push(name); continue; }
  if (b === 'vendor' && a === 'modified') { result.new.push(name); continue; }
  // vendor -> vendor: изменений нет, не доработка
}

const summary = {
  before: beforeTree,
  after: afterTree,
  vendors: vendorTrees,
  objects: { before: beforeNames.size, after: afterNames.size },
  counts: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length])),
  ok: result.lost.length === 0 && result.new.length === 0 && result.ownAdded.length === 0 && result.ownRemoved.length === 0,
};

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ summary, ...result }, null, 1));
}

console.log(JSON.stringify(summary));
const show = (title, arr) => { if (arr.length) { console.log('\n' + title + ' (' + arr.length + '):'); for (const x of arr) console.log('  ' + x); } };
show('ПОТЕРЯНЫ ДОРАБОТКИ (lost)', result.lost);
show('РОСТ РАСХОЖДЕНИЯ (new)', result.new);
show('УДАЛЕНЫ (removed — только с записью в отчёте)', result.removed);
show('СВОИ ОБЪЕКТЫ: появились', result.ownAdded);
show('СВОИ ОБЪЕКТЫ: исчезли', result.ownRemoved);

if (!summary.ok) process.exit(1);
if (result.removed.length) process.exit(2);
process.exit(0);
