// Проверка объектов из ПриЗаполненииСписковСОграничениемДоступа: метод должен быть в модуле менеджера.
// Использование: node checkaccesslists.js <resultTree> [report.json]
'use strict';
const fs = require('fs');
const path = require('path');
const [, , tree, reportPath] = process.argv;
if (!tree) { console.error('usage: node checkaccesslists.js <result> [report]'); process.exit(2); }

const DIR = {
  Документ: 'Documents', Справочник: 'Catalogs', РегистрСведений: 'InformationRegisters',
  РегистрНакопления: 'AccumulationRegisters', ПланОбмена: 'ExchangePlans', БизнесПроцесс: 'BusinessProcesses',
  Задача: 'Tasks', Отчет: 'Reports', Обработка: 'DataProcessors',
};
const modulePath = path.join(tree, 'CommonModules', 'УправлениеДоступомПереопределяемый', 'Ext', 'Module.bsl');
const text = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
const refs = new Map();
const re = /"((?:Документ|Справочник|РегистрСведений|РегистрНакопления|ПланОбмена|БизнесПроцесс|Задача|Отчет|Обработка)\.[^".]+)"/g;
let m;
while ((m = re.exec(text)) !== null) {
  const [prefix, name] = m[1].split('.');
  const dir = DIR[prefix];
  if (!dir || !name) continue;
  refs.set(m[1], dir + '/' + name);
}
const missing = [];
for (const [obj, rel] of refs) {
  const mgr = path.join(tree, rel, 'Ext', 'ManagerModule.bsl');
  const body = fs.existsSync(mgr) ? fs.readFileSync(mgr, 'utf8') : '';
  if (!/Процедура\s+ПриЗаполненииОграниченияДоступа\b/.test(body)) missing.push({ object: obj, present: fs.existsSync(mgr), empty: body.replace(/^\uFEFF/, '').trim().length === 0 });
}
const report = { objects: refs.size, missing: missing.length, details: missing, warning: refs.size === 0 ? 'нет строковых ссылок; проверьте Метаданные.* вручную' : null };
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ objects: refs.size, missing: missing.length, sample: missing.slice(0, 10) }));
process.exit(refs.size === 0 ? 2 : (missing.length ? 1 : 0));
