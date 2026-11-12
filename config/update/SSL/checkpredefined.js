// Проверка Predefined.xml: нет дублей <Item id>, нет потери имён поставки, добавленные имена объяснены.
// Использование: node checkpredefined.js <resultTree> <updateErpTree> <report.json> [catalogsCsv]
'use strict';
const fs = require('fs');
const path = require('path');
const [, , resultTree, updateTree, reportPath, catalogsCsv] = process.argv;
if (!resultTree || !updateTree) {
  console.error('usage: node checkpredefined.js <result> <update> <report> [catalogs]');
  process.exit(2);
}
const catalogs = (catalogsCsv || 'ИдентификаторыОбъектовМетаданных,НаборыДополнительныхРеквизитовИСведений').split(',').map((s) => s.trim()).filter(Boolean);
const DIR = {
  Документ: 'Documents', Справочник: 'Catalogs', РегистрСведений: 'InformationRegisters',
  РегистрНакопления: 'AccumulationRegisters', РегистрБухгалтерии: 'AccountingRegisters',
  РегистрРасчета: 'CalculationRegisters', Перечисление: 'Enums', ПланОбмена: 'ExchangePlans',
  БизнесПроцесс: 'BusinessProcesses', Задача: 'Tasks', Отчет: 'Reports', Обработка: 'DataProcessors',
};
function items(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<Item\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/Item>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const nm = /<Name>([^<]*)<\/Name>/.exec(m[2]);
    out.push({ id: m[1], name: nm ? nm[1] : null });
  }
  return out;
}
function objExists(tree, name) {
  if (!name) return true;
  for (const [prefix, dir] of Object.entries(DIR)) {
    if (name.startsWith(prefix)) {
      const obj = name.slice(prefix.length);
      if (!obj) return true;
      return fs.existsSync(path.join(tree, dir, obj + '.xml')) || fs.existsSync(path.join(tree, dir, obj));
    }
  }
  return true;
}
const report = { catalogs: [], lost: [], duplicateIds: [], duplicateNames: [], added: [], orphanNames: [] };
for (const cat of catalogs) {
  const rel = path.join('Catalogs', cat, 'Ext', 'Predefined.xml');
  const upd = path.join(updateTree, rel);
  const res = path.join(resultTree, rel);
  if (!fs.existsSync(upd) || !fs.existsSync(res)) continue;
  const a = items(upd);
  const b = items(res);
  const an = new Set(a.map((x) => x.name).filter(Boolean));
  const bn = new Set(b.map((x) => x.name).filter(Boolean));
  const ids = new Map();
  const names = new Map();
  for (const x of b) {
    ids.set(x.id, (ids.get(x.id) || 0) + 1);
    if (x.name) names.set(x.name, (names.get(x.name) || 0) + 1);
  }
  const lost = [...an].filter((n) => !bn.has(n));
  const added = [...bn].filter((n) => !an.has(n));
  const orphan = cat === 'ИдентификаторыОбъектовМетаданных' ? added.filter((n) => !objExists(resultTree, n)) : [];
  const dupIds = [...ids].filter(([, c]) => c > 1).map(([id, count]) => ({ id, count, names: b.filter((x) => x.id === id).map((x) => x.name) }));
  const dupNames = [...names].filter(([, c]) => c > 1).map(([name, count]) => ({ name, count }));
  report.catalogs.push({ catalog: cat, supply: a.length, result: b.length, added: added.length, lost: lost.length, duplicateIds: dupIds.length, orphanNames: orphan.length });
  if (lost.length) report.lost.push({ catalog: cat, names: lost });
  if (added.length) report.added.push({ catalog: cat, names: added });
  if (orphan.length) report.orphanNames.push({ catalog: cat, names: orphan });
  if (dupIds.length) report.duplicateIds.push({ catalog: cat, ids: dupIds });
  if (dupNames.length) report.duplicateNames.push({ catalog: cat, names: dupNames });
}
const fail = report.lost.length || report.duplicateIds.length || report.orphanNames.length;
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({
  catalogs: report.catalogs,
  lost: report.lost.length,
  duplicateIds: report.duplicateIds.length,
  duplicateNames: report.duplicateNames.length,
  orphanNames: report.orphanNames.length,
  added: report.added.reduce((s, x) => s + x.names.length, 0),
}));
process.exit(fail ? 1 : 0);
