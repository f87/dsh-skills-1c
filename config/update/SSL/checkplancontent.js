// Проверка согласованности: типы определяемых типов БИД должны входить в состав плана обмена
// "Интеграция с 1С:Документооборотом". Использование: node checkplancontent.js <tree>
// EXIT 1 — есть расхождения (обработчик обновления БИД упадёт).
const fs = require('fs');
const path = require('path');
const tree = process.argv[2];
if (!tree) { console.error('usage: node checkplancontent.js <tree>'); process.exit(2); }

const PLAN = 'ИнтеграцияС1СДокументооборотомПереопределяемый';
const TYPES = [
  'ИнтеграцияС1СДокументооборотВсеСсылкиПереопределяемый',
  'ИнтеграцияС1СДокументооборотДокументыОбъектыПереопределяемый',
  'ИнтеграцияС1СДокументооборотСправочникиОбъектыПереопределяемый',
];
const MAP = {
  DocumentRef: 'Document', DocumentObject: 'Document',
  CatalogRef: 'Catalog', CatalogObject: 'Catalog',
  EnumRef: 'Enum',
  ChartOfCharacteristicTypesRef: 'ChartOfCharacteristicTypes', ChartOfCharacteristicTypesObject: 'ChartOfCharacteristicTypes',
  ChartOfCalculationTypesRef: 'ChartOfCalculationTypes', ChartOfCalculationTypesObject: 'ChartOfCalculationTypes',
  ChartOfAccountsRef: 'ChartOfAccounts', ChartOfAccountsObject: 'ChartOfAccounts',
  ExchangePlanRef: 'ExchangePlan', ExchangePlanObject: 'ExchangePlan',
  InformationRegisterRef: 'InformationRegister', InformationRegisterRecordSet: 'InformationRegister',
  AccumulationRegisterRef: 'AccumulationRegister', AccumulationRegisterRecordSet: 'AccumulationRegister',
  AccountingRegisterRef: 'AccountingRegister', AccountingRegisterRecordSet: 'AccountingRegister',
  CalculationRegisterRef: 'CalculationRegister', CalculationRegisterRecordSet: 'CalculationRegister',
  BusinessProcessRef: 'BusinessProcess', BusinessProcessObject: 'BusinessProcess',
  TaskRef: 'Task', TaskObject: 'Task',
  ConstantRef: 'Constant',
  CommonModule: 'CommonModule',
  DefinedType: 'DefinedType',
};

const contentPath = path.join(tree, 'ExchangePlans', PLAN, 'Ext', 'Content.xml');
if (!fs.existsSync(contentPath)) { console.error('Нет ' + contentPath); process.exit(2); }
const content = fs.readFileSync(contentPath, 'utf8');
const items = new Set([...content.matchAll(/<Metadata>([^<]+)<\/Metadata>/g)].map((m) => m[1]));

const problems = [];
for (const dt of TYPES) {
  const f = path.join(tree, 'DefinedTypes', dt + '.xml');
  if (!fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/<v8:Type>cfg:([A-Za-z]+)\.([^<]+)<\/v8:Type>/g)) {
    const kind = MAP[m[1]];
    if (!kind) continue;
    const item = kind + '.' + m[2];
    if (items.has(item)) continue;
    // объект существует в дереве?
    const dir = { Document: 'Documents', Catalog: 'Catalogs', Enum: 'Enums', ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes', ChartOfCalculationTypes: 'ChartsOfCalculationTypes', ChartOfAccounts: 'ChartsOfAccounts', ExchangePlan: 'ExchangePlans', InformationRegister: 'InformationRegisters', AccumulationRegister: 'AccumulationRegisters', AccountingRegister: 'AccountingRegisters', CalculationRegister: 'CalculationRegisters', BusinessProcess: 'BusinessProcesses', Task: 'Tasks', Constant: 'Constants' }[kind];
    const exists = dir ? fs.existsSync(path.join(tree, dir, m[2] + '.xml')) : true;
    problems.push({ definedType: dt, type: m[1] + '.' + m[2], item, objectExists: exists });
  }
}
const unique = [];
const seen = new Set();
for (const p of problems) { const k = p.definedType + '|' + p.item; if (!seen.has(k)) { seen.add(k); unique.push(p); } }
console.log(JSON.stringify({ plan: PLAN, missing: unique.length, items: unique }, null, 1));
process.exit(unique.length ? 1 : 0);
