// Переименование ссылок на переименованные объекты строго по квалифицированным именам типов.
// Использование: node multirename2.js <tree> <pairs.json>   (пары "Type.Old" -> "Type.New")
const fs = require('fs');
const path = require('path');
const [, , tree, pairsPath] = process.argv;
const pairs = JSON.parse(fs.readFileSync(pairsPath, 'utf8'));

const REFS = {
  Catalog: ['CatalogRef', 'CatalogObject', 'CatalogSelection', 'Catalog'],
  Document: ['DocumentRef', 'DocumentObject', 'Document'],
  Enum: ['EnumRef', 'Enum'],
  InformationRegister: ['InformationRegisterRef', 'InformationRegisterRecordSet', 'InformationRegisterRecordKey', 'InformationRegister'],
  AccumulationRegister: ['AccumulationRegisterRef', 'AccumulationRegisterRecordSet', 'AccumulationRegister'],
  AccountingRegister: ['AccountingRegisterRef', 'AccountingRegisterRecordSet', 'AccountingRegister'],
  CalculationRegister: ['CalculationRegisterRef', 'CalculationRegisterRecordSet', 'CalculationRegister'],
  ChartOfCharacteristicTypes: ['ChartOfCharacteristicTypesRef', 'ChartOfCharacteristicTypes'],
  ChartOfCalculationTypes: ['ChartOfCalculationTypesRef', 'ChartOfCalculationTypes'],
  ChartOfAccounts: ['ChartOfAccountsRef', 'ChartOfAccounts'],
  BusinessProcess: ['BusinessProcessRef', 'BusinessProcessObject', 'BusinessProcess'],
  Task: ['TaskRef', 'TaskObject', 'Task'],
  ExchangePlan: ['ExchangePlanRef', 'ExchangePlan'],
  DocumentJournal: ['DocumentJournalRef', 'DocumentJournal'],
  CommonModule: ['CommonModule'],
  CommonForm: ['CommonForm'],
  DataProcessor: ['DataProcessorRef', 'DataProcessorObject', 'DataProcessor'],
  Report: ['ReportRef', 'ReportObject', 'Report'],
  Constant: ['ConstantRef', 'Constant'],
  DefinedType: ['DefinedType'],
  FunctionalOption: ['FunctionalOption'],
  FilterCriterion: ['FilterCriterion'],
};

const rules = [];
for (const [oldQ, newQ] of pairs) {
  const [type, oldName] = oldQ.split('.');
  const [, newName] = newQ.split('.');
  if (!type || !oldName || !newName || oldName === newName) continue;
  for (const p of (REFS[type] || [type])) rules.push([p + '.' + oldName, p + '.' + newName, oldName]);
}

let files = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!(e.name.endsWith('.xml') || e.name.endsWith('.bsl'))) continue;
    let t;
    try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const before = t;
    for (const [o, n] of rules) {
      if (!t.includes(o)) continue;
      const safe = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp(safe + '(?![A-Za-zА-Яа-я_0-9])', 'g'), n);
    }
    if (t !== before) { fs.writeFileSync(full, t); files++; }
  }
}
walk(tree);
console.log(JSON.stringify({ files, rules: rules.length }));
