// Сверка набора <Name> объектов с поставкой ЕРП (после renamerefs.js).
// Использование: node checknames.js <resultTree> <updateErpTree> <object[,object...]|file.json> [report.json]
// Код возврата: 1 — в результате потеряны определения, которые есть в поставке.
'use strict';
const fs = require('fs');
const path = require('path');

let [, , resultTree, updateTree, listArg, reportPath] = process.argv;
if (resultTree === '--all') { resultTree = updateTree; updateTree = listArg; listArg = '--all'; }
if (!listArg) { console.error('usage: node checknames.js <resultTree> <updateErpTree> <objects|file.json|--all> [report]'); process.exit(2); }

const DIR = {
  Catalog: 'Catalogs', Document: 'Documents', Enum: 'Enums', Report: 'Reports', DataProcessor: 'DataProcessors',
  InformationRegister: 'InformationRegisters', AccumulationRegister: 'AccumulationRegisters',
  AccountingRegister: 'AccountingRegisters', CalculationRegister: 'CalculationRegisters',
  ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes', ChartOfCalculationTypes: 'ChartsOfCalculationTypes',
  ChartOfAccounts: 'ChartsOfAccounts', BusinessProcess: 'BusinessProcesses', Task: 'Tasks',
  ExchangePlan: 'ExchangePlans', CommonModule: 'CommonModules', CommonForm: 'CommonForms',
  CommonTemplate: 'CommonTemplates', CommonPicture: 'CommonPictures', CommonCommand: 'CommonCommands',
  Constant: 'Constants', DefinedType: 'DefinedTypes', Role: 'Roles', Subsystem: 'Subsystems',
  DocumentJournal: 'DocumentJournals', Sequence: 'Sequences', SettingsStorage: 'SettingsStorages',
  FilterCriterion: 'FilterCriteria', FunctionalOption: 'FunctionalOptions', EventSubscription: 'EventSubscriptions',
  WebService: 'WebServices', HTTPService: 'HTTPServices', XDTOPackage: 'XDTOPackages', Bot: 'Bots',
};

let objects;
if (listArg === '--all') {
  objects = [];
  const dirToType = new Map(Object.entries(DIR).map(([t, d]) => [d, t]));
  for (const e of fs.readdirSync(updateTree, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'Ext') continue;
    const type = dirToType.get(e.name);
    if (!type) continue;
    for (const f of fs.readdirSync(path.join(updateTree, e.name), { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith('.xml')) objects.push(type + '.' + f.name.slice(0, -4));
    }
  }
} else if (fs.existsSync(listArg)) {
  const raw = fs.readFileSync(listArg, 'utf8').trim();
  try { const j = JSON.parse(raw); objects = Array.isArray(j) ? j : [j]; } catch { objects = raw.split(/\r?\n/).filter(Boolean); }
} else {
  objects = listArg.split(',').map((s) => s.trim()).filter(Boolean);
}

const names = (text) => new Set([...text.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]));
const report = { resultTree, updateTree, objects: objects.length, checked: [], missing: [], extra: [] };
for (const obj of objects) {
  const [type, name] = String(obj).split('.');
  const dir = DIR[type];
  if (!dir) { report.missing.push({ object: obj, reason: 'unknown type' }); continue; }
  const rel = path.join(dir, name + '.xml');
  const src = path.join(updateTree, rel);
  const dst = path.join(resultTree, rel);
  if (!fs.existsSync(src)) { report.missing.push({ object: obj, reason: 'нет в поставке' }); continue; }
  if (!fs.existsSync(dst)) { report.missing.push({ object: obj, reason: 'нет в результате' }); continue; }
  const A = names(fs.readFileSync(src, 'utf8'));
  const B = names(fs.readFileSync(dst, 'utf8'));
  const lost = [...A].filter((n) => !B.has(n));
  const add = [...B].filter((n) => !A.has(n));
  report.checked.push({ object: obj, delivery: A.size, result: B.size, lost: lost.length, added: add.length });
  if (lost.length) report.missing.push({ object: obj, lost });
  if (add.length) report.extra.push({ object: obj, added: add.slice(0, 20) });
}
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ objects: report.objects, checked: report.checked.length, lostObjects: report.missing.length, extraObjects: report.extra.length, missing: report.missing.slice(0, 10), extraSample: report.extra.slice(0, 5) }, null, 1));
process.exit(report.missing.length ? 1 : 0);
