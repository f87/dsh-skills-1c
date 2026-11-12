// Добавление недостающих элементов в состав плана обмена "Интеграция с 1С:Документооборотом"
// по типам определяемых типов БИД. Использование:
//   node fixplancontent.js <tree> <donorTree> [--apply] [reportJson]
// Без --apply — только отчёт. Элементы берутся из donor Content.xml, иначе AutoRecord=Allow.
const fs = require('fs');
const path = require('path');

const [, , tree, donor, applyArg, reportPath] = process.argv;
const apply = applyArg === '--apply';
if (!tree || !donor) { console.error('usage: node fixplancontent.js <tree> <donor> [--apply] [report]'); process.exit(2); }

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
};
const DIR = { Document: 'Documents', Catalog: 'Catalogs', Enum: 'Enums', ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes', ChartOfCalculationTypes: 'ChartsOfCalculationTypes', ChartOfAccounts: 'ChartsOfAccounts', ExchangePlan: 'ExchangePlans', InformationRegister: 'InformationRegisters', AccumulationRegister: 'AccumulationRegisters', AccountingRegister: 'AccountingRegisters', CalculationRegister: 'CalculationRegisters', BusinessProcess: 'BusinessProcesses', Task: 'Tasks', Constant: 'Constants' };

const contentPath = path.join(tree, 'ExchangePlans', PLAN, 'Ext', 'Content.xml');
const donorPath = path.join(donor, 'ExchangePlans', PLAN, 'Ext', 'Content.xml');
if (!fs.existsSync(contentPath)) { console.error('Нет ' + contentPath); process.exit(2); }
const raw = fs.readFileSync(contentPath);
const hasBom = raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
let text = raw.toString('utf8').replace(/^\uFEFF/, '');
const donorText = fs.existsSync(donorPath) ? fs.readFileSync(donorPath, 'utf8') : '';
const items = new Set([...text.matchAll(/<Metadata>([^<]+)<\/Metadata>/g)].map((m) => m[1]));

const missing = [];
const seen = new Set();
for (const dt of TYPES) {
  const f = path.join(tree, 'DefinedTypes', dt + '.xml');
  if (!fs.existsSync(f)) continue;
  const body = fs.readFileSync(f, 'utf8');
  for (const m of body.matchAll(/<v8:Type>cfg:([A-Za-z]+)\.([^<]+)<\/v8:Type>/g)) {
    const kind = MAP[m[1]];
    if (!kind) continue;
    const item = kind + '.' + m[2];
    if (items.has(item) || seen.has(item)) continue;
    const exists = fs.existsSync(path.join(tree, DIR[kind] || '', m[2] + '.xml'));
    if (!exists) continue; // ссылку на отсутствующий объект убирает prunetypes
    seen.add(item);
    missing.push(item);
  }
}

if (!missing.length) {
  console.log(JSON.stringify({ missing: 0, apply }));
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ missing: [], apply }, null, 1));
  process.exit(0);
}

const blocks = [];
for (const item of missing) {
  const m = donorText.match(new RegExp('<Item>\\s*<Metadata>' + item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</Metadata>[\\s\\S]*?</Item>'));
  const block = m ? m[0] : '<Item>\n\t\t<Metadata>' + item + '</Metadata>\n\t\t<AutoRecord>Allow</AutoRecord>\n\t</Item>';
  blocks.push('\t' + block + '\n');
}

if (apply) {
  const close = text.lastIndexOf('</ExchangePlanContent>');
  text = text.slice(0, close) + blocks.join('') + text.slice(close);
  fs.writeFileSync(contentPath, (hasBom ? '\uFEFF' : '') + text, 'utf8');
}
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ missing, apply }, null, 1));
console.log(JSON.stringify({ missing: missing.length, items: missing, apply }));
