#!/usr/bin/env node
'use strict';
/*
 * bin_summary.js — сводка Ext\ParentConfigurations.bin в JSON (для скриптов приёмки и отчётов).
 *
 *   node bin_summary.js <ParentConfigurations.bin>
 *
 * Печатает: размер, SHA1, BOM/round-trip, флаг конфигурации, число поставок, guid поддержки, хвост,
 * и по каждой поставке — parentGuid, «своя» ли (parentGuid == supportGuid), флаг, guid, версию,
 * вендора, имя, число записей, распределение уровней (0/1/2) и режимов.
 * Только чтение. Коды возврата: 0 — ok, 2 — аргументы, 3 — файл не разобран.
 */
const fs = require('fs');
const path = require('path');
const { parseBin } = require(path.join(__dirname, '..', 'support', 'inspect_bin.js'));

const file = process.argv[2];
if (!file) { console.error('usage: node bin_summary.js <ParentConfigurations.bin>'); process.exit(2); }
if (!fs.existsSync(file)) { console.error('файла нет: ' + file); process.exit(3); }

let b;
try { b = parseBin(fs.readFileSync(file)); } catch (e) { console.error('ОШИБКА разбора: ' + e.message); process.exit(3); }

const deliveries = b.deliveries.map((d, i) => {
  const levels = { 0: 0, 1: 0, 2: 0, other: 0 };
  const modes = {};
  for (let k = 0; k < d.objects; k++) {
    const g = d.objStart + 4 * k;
    const l = b.tokens[g], m = b.tokens[g + 1];
    if (levels[l] === undefined) levels.other++; else levels[l]++;
    modes[m] = (modes[m] || 0) + 1;
  }
  return {
    index: i, name: d.name, version: d.version, vendor: d.vendor,
    parentGuid: b.tokens[d.start], own: b.tokens[d.start] === b.supportGuid,
    flag: d.flag, guid: d.guid, objects: d.objects, levels, modes,
  };
});

console.log(JSON.stringify({
  file,
  size: b.buf.length,
  sha1: b.sha1.toUpperCase(),
  bom: b.hasBom,
  utf8RoundTrip: b.utf8BytesOk,
  tokensRoundTrip: b.reserializeOk,
  flag: b.headerFlag,
  count: b.count,
  supportGuid: b.supportGuid,
  ownDelivery: (deliveries.find((d) => d.own) || {}).name || null,
  tail: b.tail,
  tailLength: b.tail.length,
  deliveries,
}, null, 1));
