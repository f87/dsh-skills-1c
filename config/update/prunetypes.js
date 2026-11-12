// Удаление ссылок на отсутствующие объекты метаданных в составах типов.
// Использование: node prunetypes.js <tree>
const fs = require('fs');
const path = require('path');
const tree = process.argv[2];

const PREFIX_DIR = {
  CatalogRef: 'Catalogs', CatalogObject: 'Catalogs', CatalogSelection: 'Catalogs',
  DocumentSelection: 'Documents', ExchangePlanObject: 'ExchangePlans', ChartOfCharacteristicTypesObject: 'ChartsOfCharacteristicTypes', ChartOfCalculationTypesObject: 'ChartsOfCalculationTypes', ChartOfAccountsObject: 'ChartsOfAccounts', ReportObject: 'Reports', DataProcessorObject: 'DataProcessors', InformationRegisterSelection: 'InformationRegisters', AccumulationRegisterRecordKey: 'AccumulationRegisters', AccumulationRegisterSelection: 'AccumulationRegisters', AccountingRegisterRecordKey: 'AccountingRegisters',
  DocumentRef: 'Documents', DocumentObject: 'Documents',
  EnumRef: 'Enums',
  InformationRegisterRef: 'InformationRegisters', InformationRegisterRecordSet: 'InformationRegisters', InformationRegisterRecordKey: 'InformationRegisters',
  AccumulationRegisterRef: 'AccumulationRegisters', AccumulationRegisterRecordSet: 'AccumulationRegisters',
  AccountingRegisterRef: 'AccountingRegisters', AccountingRegisterRecordSet: 'AccountingRegisters',
  CalculationRegisterRef: 'CalculationRegisters', CalculationRegisterRecordSet: 'CalculationRegisters',
  BusinessProcessRef: 'BusinessProcesses', BusinessProcessObject: 'BusinessProcesses',
  TaskRef: 'Tasks', TaskObject: 'Tasks',
  ExchangePlanRef: 'ExchangePlans',
  ChartOfCharacteristicTypesRef: 'ChartsOfCharacteristicTypes',
  ChartOfCalculationTypesRef: 'ChartsOfCalculationTypes',
  ChartOfAccountsRef: 'ChartsOfAccounts',
  DocumentJournalRef: 'DocumentJournals',
  DefinedType: 'DefinedTypes',
  ConstantRef: 'Constants',
  CommonModule: 'CommonModules',
};

let removed = 0, files = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!e.name.endsWith('.xml')) continue;
    let t;
    try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (!t.includes('<v8:Type>') && !t.includes('<v8:TypeSet>')) continue;
    const before = t;
    t = t.replace(/[ \t]*<v8:Type>(cfg:)?([A-Za-z]+)\.([^<]+)<\/v8:Type>\r?\n/g, (m, cfg, prefix, name) => {
      if (!cfg) return m; // примитивы xs:...
      const d = PREFIX_DIR[prefix];
      if (!d) return m;
      const f = path.join(tree, d, name + '.xml');
      if (fs.existsSync(f)) return m;
      removed++;
      return '';
    });
    // <v8:TypeSet>cfg:DefinedType.X</v8:TypeSet> на отсутствующий DefinedTypes\X.xml
    t = t.replace(/[ \t]*<v8:TypeSet>cfg:DefinedType\.([^<]+)<\/v8:TypeSet>\r?\n/g, (m, name) => {
      const f = path.join(tree, 'DefinedTypes', name + '.xml');
      if (fs.existsSync(f)) return m;
      removed++;
      return '';
    });
    if (t !== before) { fs.writeFileSync(full, t); files++; }
  }
}
walk(tree);
console.log(JSON.stringify({ files, removed }));
