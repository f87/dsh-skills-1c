#!/usr/bin/env node
'use strict';
/*
 * build_two_deliveries_bin.js — собрать Ext\ParentConfigurations.bin с ДВУМЯ поставками поставщика
 * из двух одноставочных .bin (правила раздела — config\supply\deliveries.md).
 *
 *   node build_two_deliveries_bin.js --main <bin> --extra <bin> --out <new.bin> [--write] [--config <Configuration.xml>]
 *        [--ref <bin>] [--cdi <ConfigDumpInfo.xml>] [--mode vendor|adapt]
 *        [--order main|extra] [--header main|extra|<guid>]
 *        [--flag <0|1>] [--flag-main <0|1>] [--flag-extra <0|1>]
 *        [--guid-main <guid>] [--guid-extra <guid>] [--parent-main <guid>] [--parent-extra <guid>]
 *        [--tail auto|ref] [--allow-dupes]
 *
 *   --main  — .bin главной поставки (поставка 0); --extra — .bin дополнительной. Каждый файл должен
 *             содержать РОВНО одну поставку.
 *   --config — Configuration.xml собираемой конфигурации: сверяет пару «имя, версия» главной поставки
 *             с конфигурацией (правило config\supply\which-is-main.md). Расхождение — предупреждение в
 *             отчёте (с `--strict` — ошибка).
 *   --ref   — .bin-эталон с двумя поставками: из него берутся порядок (какая поставка «своя»),
 *             заголовочный supportGuid и — в режиме adapt — уровни поддержки записей.
 *   --cdi   — ConfigDumpInfo.xml итоговой конфигурации: в режиме adapt выбрасываются записи, которых
 *             нет в конфигурации, и записи, уже занятые главной поставкой.
 *
 * Режимы:
 *   vendor (по умолчанию) — записи и уровни дополнительной поставки берутся как в её собственном .bin;
 *   adapt                 — уровни переносятся по UUID из --ref, плюс фильтр по --cdi (если задан).
 *
 * Ключи состояния: --header — чей guid поддержки в заголовке (по умолчанию главной поставки);
 *   --flag* — флаг «изменения запрещены»; копия *.cf существует только у поставки с флагом 0;
 *   --parent-* — parentGuid поставки; --tail auto — хвост «как есть» из исходных файлов, ref — из --ref.
 *
 * По умолчанию файл НЕ пишется (dry-run): для записи нужны --out и --write.
 * Выход: JSON-отчёт; коды 0 — ok, 2 — аргументы, 3 — входные файлы, 4 — проверка результата, 5 — запись.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseBin } = require(path.join(__dirname, '..', 'support', 'inspect_bin.js'));

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const TAIL_GROUP = 10; // чисел хвоста на одну поставку
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const stripBrace = (t) => t.replace(/\}$/, '');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def === undefined ? null : def;
  const v = process.argv[i + 1];
  return v !== undefined && !v.startsWith('--') ? v : true;
}
const flagOn = (name) => process.argv.includes('--' + name);

// Разбор с проверками формата: на вход идёт файл, который должен быть ровно таким, каким его пишет 1С.
function parseStrict(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label}: файла нет — ${file}`);
  const buf = fs.readFileSync(file);
  const b = parseBin(buf);
  const bad = [];
  if (!b.hasBom) bad.push('нет BOM (UTF-8 BOM обязателен)');
  if (!b.utf8BytesOk) bad.push('текст не воспроизводит байты (не UTF-8?)');
  if (!b.reserializeOk) bad.push('токенизация не воспроизводит файл (кавычки/запятые) — править нельзя');
  if (/[\r\n]/.test(b.text)) bad.push('есть переводы строк — формат требует одну строку');
  if (!b.text.endsWith('}')) bad.push('не заканчивается на "}"');
  if (b.tokens[0] !== '{6') bad.push('token0 = ' + JSON.stringify(b.tokens[0]) + ' (ожидалось "{6")');
  if (!Number.isInteger(b.count) || b.count < 1) bad.push('битый счётчик поставок');
  for (const d of b.deliveries) {
    if (!Number.isInteger(d.objects) || d.objects < 0) bad.push(`поставка ${d.index}: битый счётчик записей`);
    else if (b.tokens[d.end - 2] !== '0' || b.tokens[d.end - 1] !== '0') {
      bad.push(`поставка ${d.index}: служебные токены не "0,0" (${b.tokens[d.end - 2]},${b.tokens[d.end - 1]})`);
    }
    for (let k = 0; k < d.objects; k++) {
      const g = d.objStart + 4 * k;
      if (!/^[0-9a-f-]{36}$/i.test(b.tokens[g + 2])) { bad.push(`поставка ${d.index}, запись ${k}: битый uuid`); break; }
    }
  }
  if (bad.length) throw new Error(`${label}: ${file}\n  - ${bad.join('\n  - ')}`);
  b.file = file;
  return b;
}

function recs(bin, d) {
  const out = new Array(d.objects);
  for (let k = 0; k < d.objects; k++) {
    const g = d.objStart + 4 * k;
    out[k] = { lvl: bin.tokens[g], mode: bin.tokens[g + 1], uuid: bin.tokens[g + 2], inDelivery: bin.tokens[g + 3] };
  }
  return out;
}
const levelsOf = (list) => {
  const lv = { 0: 0, 1: 0, 2: 0, other: 0 };
  for (const r of list) { if (lv[r.lvl] === undefined) lv.other++; else lv[r.lvl]++; }
  return lv;
};

// пары «имя, версия, вендор» из Configuration.xml — чтобы проверить, что главная поставка та, что нужно
function readConfigXml(file) {
  const s = fs.readFileSync(file, 'utf8');
  const pick = (tag) => { const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(s); return m ? m[1] : null; };
  return { name: pick('Name'), version: pick('Version'), vendor: pick('Vendor') };
}

// uuid -> dotted name из ConfigDumpInfo.xml
function readCdi(file) {
  const text = fs.readFileSync(file, 'utf8');
  const map = new Map();
  const re = /<Metadata\s+([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = /id="([0-9a-fA-F-]{36})"/.exec(m[1]);
    const nm = /name="([^"]*)"/.exec(m[1]);
    if (id && nm) map.set(id[1].toLowerCase(), nm[1]);
  }
  return map;
}

function main() {
  const mainPath = arg('main');
  const extraPath = arg('extra');
  const outPath = typeof arg('out') === 'string' ? arg('out') : null;
  if (!mainPath || !extraPath || mainPath === true || extraPath === true) {
    console.error('usage: node build_two_deliveries_bin.js --main <bin> --extra <bin> --out <new.bin> [--write] [--config <Configuration.xml>] [--strict] [--ref <bin>] [--cdi <ConfigDumpInfo.xml>] [--mode vendor|adapt] [--order main|extra] [--header main|extra|<guid>] [--flag N] [--flag-main N] [--flag-extra N] [--guid-main <guid>] [--guid-extra <guid>] [--parent-main <guid>] [--parent-extra <guid>] [--tail auto|ref] [--allow-dupes]');
    process.exit(2);
  }
  const mode = arg('mode', 'vendor');
  if (!['vendor', 'adapt'].includes(mode)) { console.error('--mode: ожидалось vendor|adapt, получено ' + mode); process.exit(2); }
  const warnings = [];

  // ---------- входные файлы ----------
  const mainBin = parseStrict(mainPath, 'main');
  const extraBin = parseStrict(extraPath, 'extra');
  for (const [label, b] of [['main', mainBin], ['extra', extraBin]]) {
    if (b.count !== 1) { console.error(`${label}: ожидалась ровно одна поставка, найдено ${b.count} (разберите файл на поставки отдельно: см. config\\supply\\deliveries.md)`); process.exit(3); }
    if (b.deliveries[0].objects < 1) { console.error(`${label}: поставка без записей`); process.exit(3); }
  }
  const dMain = mainBin.deliveries[0];
  const dExtra = extraBin.deliveries[0];
  if (dMain.guid === dExtra.guid && dMain.name === dExtra.name && dMain.version === dExtra.version) {
    console.error('main и extra — одна и та же поставка (guid+имя+версия): сливать нечего');
    process.exit(3);
  }

  // ---------- проверка «главная — та, что заявлена» ----------
  const configPath = arg('config');
  let configCheck = 'не проверялось';
  if (typeof configPath === 'string') {
    const cfg = readConfigXml(configPath);
    const same = (a, b) => String(a || '').trim() === String(b || '').trim();
    const nameOk = same(cfg.name, dMain.name);
    const verOk = same(cfg.version, dMain.version);
    const vendorOk = same(cfg.vendor, dMain.vendor);
    configCheck = { config: cfg, main: { name: dMain.name, version: dMain.version, vendor: dMain.vendor }, nameOk, versionOk: verOk, vendorOk };
    if (!nameOk || !verOk) {
      const msg = `--main: пара «имя, версия» не совпадает с Configuration.xml (${cfg.name} ${cfg.version}): `
        + `по правилу which-is-main.md главной должна быть поставка продукта, а не дополнения`;
      if (flagOn('strict')) { console.error(msg); process.exit(3); }
      warnings.push(msg);
    } else if (!vendorOk) {
      warnings.push(`--main: вендор главной поставки (${dMain.vendor}) не совпадает с Configuration.xml (${cfg.vendor})`);
    }
  }

  // ---------- эталон ----------
  const refPath = arg('ref');
  let ref = null, ownIsMain = true, refExtraLevels = null;
  if (typeof refPath === 'string') {
    ref = parseStrict(refPath, 'ref');
    const own = ref.deliveries.find((d) => ref.tokens[d.start] === ref.supportGuid);
    if (own) ownIsMain = own.name === dMain.name;
    const refExtra = ref.deliveries.find((d) => d.name === dExtra.name)
      || (ref.count === 2 ? ref.deliveries.find((d) => d.name !== dMain.name) : null);
    if (refExtra) refExtraLevels = new Map(recs(ref, refExtra).map((r) => [r.uuid.toLowerCase(), r.lvl]));
    else warnings.push('--ref: в эталоне нет поставки с именем extra — уровни adapt-режима не перенесены');
  }
  if (arg('order') === 'main') ownIsMain = true;
  else if (arg('order') === 'extra') ownIsMain = false;

  // ---------- фильтр и уровни дополнительной поставки ----------
  const cdiPath = arg('cdi');
  const cdi = typeof cdiPath === 'string' ? readCdi(cdiPath) : null;
  const mainUuids = new Set(recs(mainBin, dMain).map((r) => r.uuid.toLowerCase()));
  let extraRecs = recs(extraBin, dExtra);
  const stat = { total: extraRecs.length, droppedUnknown: 0, droppedDuplicate: 0, levelAdapted: 0,
    droppedSamples: [], duplicateSamples: [], levelSamples: [] };
  if (mode === 'adapt') {
    if (cdi) {
      extraRecs = extraRecs.filter((r) => {
        const k = r.uuid.toLowerCase();
        if (!cdi.has(k)) { stat.droppedUnknown++; if (stat.droppedSamples.length < 8) stat.droppedSamples.push(r.uuid); return false; }
        if (mainUuids.has(k)) { stat.droppedDuplicate++; if (stat.duplicateSamples.length < 8) stat.duplicateSamples.push(cdi.get(k)); return false; }
        return true;
      });
    } else {
      warnings.push('--mode adapt без --cdi: записи дополнительной поставки не отфильтрованы по составу конфигурации');
    }
    if (refExtraLevels) {
      extraRecs = extraRecs.map((r) => {
        const l = refExtraLevels.get(r.uuid.toLowerCase());
        if (l !== undefined && l !== r.lvl) {
          stat.levelAdapted++;
          if (stat.levelSamples.length < 8) stat.levelSamples.push(`${r.uuid} ${r.lvl}->${l}`);
          return { ...r, lvl: l };
        }
        return r;
      });
    }
  }

  // ---------- шапки поставок ----------
  const over = (tag) => ({
    flag: arg('flag-' + tag), guid: arg('guid-' + tag), parent: arg('parent-' + tag),
  });
  const headerOf = (bin, d) => bin.tokens.slice(d.start + 1, d.start + 6); // flag,guid,"ver","vendor","name"
  function block(bin, d, list, tag) {
    const o = over(tag);
    const h = headerOf(bin, d).slice();
    if (typeof o.flag === 'string') h[0] = o.flag;
    if (typeof o.guid === 'string') h[1] = o.guid;
    return { tag, name: d.name, version: d.version, vendor: d.vendor, srcFlag: d.flag,
      h, recs: list, parent: typeof o.parent === 'string' ? o.parent : bin.supportGuid };
  }
  const bMain = block(mainBin, dMain, recs(mainBin, dMain), 'main');
  const bExtra = block(extraBin, dExtra, extraRecs, 'extra');
  const order = ownIsMain ? [bMain, bExtra] : [bExtra, bMain];
  const mainIsFirst = ownIsMain;

  // ---------- заголовок ----------
  const headerArg = arg('header');
  let headerGuid;
  if (typeof headerArg === 'string') {
    if (headerArg === 'main') headerGuid = mainBin.supportGuid;
    else if (headerArg === 'extra') headerGuid = extraBin.supportGuid;
    else headerGuid = headerArg;
  } else if (ref && typeof headerArg !== 'string') headerGuid = ref.supportGuid;
  else headerGuid = mainIsFirst ? mainBin.supportGuid : extraBin.supportGuid;
  // parentGuid первой поставки = заголовочный supportGuid (отдельным токеном он не пишется)
  if (typeof over(order[0].tag).parent !== 'string') order[0].parent = headerGuid;

  // ---------- глобальный флаг и предупреждения о копиях *.cf ----------
  const globalFlag = typeof arg('flag') === 'string' ? arg('flag') : String(ref ? ref.flag : mainBin.flag);
  for (const b of [bMain, bExtra]) {
    const f = Number(b.h[0]);
    if (f === 1) warnings.push(`поставка «${b.name}» с флагом 1: 1С удалит её копию *.cf из Ext\\ParentConfigurations (нужна копия — ставьте флаг 0)`);
  }

  // ---------- хвост ----------
  const tailMode = arg('tail') === 'ref' ? 'ref' : 'auto';
  let tailTokens;
  if (tailMode === 'ref') {
    if (!ref) { console.error('--tail ref требует --ref'); process.exit(2); }
    if (ref.tail.length !== 3 + 2 * TAIL_GROUP) {
      console.error(`--tail ref: у эталона ${ref.tail.length} токенов хвоста, ожидалось ${3 + 2 * TAIL_GROUP}`);
      process.exit(2);
    }
    tailTokens = ref.tail.map(stripBrace);
  } else {
    const srcOwn = mainIsFirst ? mainBin : extraBin;
    const srcOther = mainIsFirst ? extraBin : mainBin;
    const prefix = srcOwn.tail.slice(0, srcOwn.tail.length - TAIL_GROUP).map(stripBrace);
    const groupOwn = srcOwn.tail.slice(srcOwn.tail.length - TAIL_GROUP).map(stripBrace);
    const groupOther = srcOther.tail.slice(srcOther.tail.length - TAIL_GROUP).map(stripBrace);
    tailTokens = [...prefix, ...groupOwn, ...groupOther];
  }

  // ---------- сборка ----------
  const recTokens = (list) => {
    const a = new Array(list.length * 4);
    for (let i = 0; i < list.length; i++) {
      a[4 * i] = list[i].lvl; a[4 * i + 1] = list[i].mode; a[4 * i + 2] = list[i].uuid; a[4 * i + 3] = list[i].inDelivery;
    }
    return a;
  };
  let tokens = ['{6', globalFlag, '2'];
  for (const b of order) tokens = tokens.concat([b.parent], b.h, [String(b.recs.length)], recTokens(b.recs), ['0', '0']);
  tokens = tokens.concat(tailTokens);
  tokens[tokens.length - 1] += '}';
  const body = Buffer.from(tokens.join(','), 'utf8');
  const outBuf = Buffer.concat([BOM, body]);

  // ---------- проверки ----------
  const problems = [];
  const re = parseBin(outBuf);
  if (re.count !== 2) problems.push('поставок ' + re.count + ', ожидалось 2');
  if (re.text !== body.toString('utf8')) problems.push('round-trip токенов != исходный текст');
  if (!re.hasBom) problems.push('нет BOM');
  if (!re.text.endsWith('}')) problems.push('нет закрывающей "}"');
  for (let i = 0; i < re.count; i++) {
    const d = re.deliveries[i], b = order[i];
    if (d.objects !== b.recs.length) problems.push(`поставка ${i}: N ${d.objects} != записей ${b.recs.length}`);
    if (d.version !== b.version) problems.push(`поставка ${i}: версия "${d.version}" != "${b.version}"`);
    if (d.name !== b.name) problems.push(`поставка ${i}: имя "${d.name}" != "${b.name}"`);
  }
  if (re.tokens[re.deliveries[0].start] !== re.supportGuid) problems.push('parentGuid поставки 0 != заголовочный supportGuid');
  const seen = new Set(); const dupes = []; let dupeCount = 0;
  for (let i = 0; i < re.count; i++) {
    for (const r of recs(re, re.deliveries[i])) {
      const k = r.uuid.toLowerCase();
      if (seen.has(k)) { dupeCount++; if (dupes.length < 20) dupes.push(k); } else seen.add(k);
    }
  }
  if (dupes.length && mode === 'adapt' && !flagOn('allow-dupes')) {
    problems.push(`UUID в обеих поставках: ${dupeCount} (${dupes.slice(0, 5).join(', ')}${dupeCount > 5 ? ', …' : ''}).`
      + ' В режиме adapt это признак того, что фильтр не сработал: задайте --cdi <ConfigDumpInfo.xml>,'
      + ' либо --allow-dupes, если пересечения ожидаемы (см. deliveries.md §2.5)');
  }
  if (dupes.length) warnings.push(`UUID встречаются в обеих поставках: ${dupeCount}${dupes.length ? ' (первый: ' + dupes[0] + ')' : ''} — для нескольких поставок это норма (см. deliveries.md §2.5)`);
  if (problems.length) { console.error('ПРОВЕРКА НЕ ПРОЙДЕНА:\n  - ' + problems.join('\n  - ')); process.exit(4); }

  // ---------- отчёт ----------
  const meta = re.deliveries.map((d, i) => ({
    index: i, name: d.name, version: d.version, vendor: d.vendor, flag: d.flag,
    parentGuid: re.tokens[d.start], own: re.tokens[d.start] === re.supportGuid,
    objects: d.objects, levels: levelsOf(recs(re, d)), source: order[i].tag,
  }));
  const res = {
    mode, order: order.map((b) => b.tag), mainFirst: mainIsFirst,
    headerGuid: re.supportGuid, globalFlag, configCheck, adaptations: stat,
    deliveries: meta, totalObjects: meta.reduce((s, d) => s + d.objects, 0),
    tokens: tokens.length, bytes: outBuf.length, tailLength: re.tail.length, sha1: sha1(outBuf),
    written: false, warnings,
  };
  if (outPath) res.out = outPath;
  if (flagOn('write')) {
    if (!outPath) { console.error('--write требует --out'); process.exit(2); }
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, outBuf);
    if (sha1(fs.readFileSync(outPath)) !== res.sha1) { console.error('файл на диске не совпал с буфером'); process.exit(5); }
    res.written = true;
  }
  console.log(JSON.stringify(res, null, 1));
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('ОШИБКА: ' + e.message); process.exit(1); }
}
