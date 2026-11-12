// Удаление ссылок на отсутствующие объекты из Content/списков (xr:Item/xr:Object).
// Использование: node prunerefs.js <tree>
const fs = require('fs');
const path = require('path');
const tree = process.argv[2];
const DIR = {
  Catalog: 'Catalogs', Document: 'Documents', Enum: 'Enums', Report: 'Reports',
  DataProcessor: 'DataProcessors', InformationRegister: 'InformationRegisters',
  AccumulationRegister: 'AccumulationRegisters', AccountingRegister: 'AccountingRegisters',
  CalculationRegister: 'CalculationRegisters', ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes',
  ChartOfCalculationTypes: 'ChartsOfCalculationTypes', ChartOfAccounts: 'ChartsOfAccounts',
  BusinessProcess: 'BusinessProcesses', Task: 'Tasks', ExchangePlan: 'ExchangePlans',
  CommonModule: 'CommonModules', Constant: 'Constants', DefinedType: 'DefinedTypes',
  FunctionalOption: 'FunctionalOptions', Role: 'Roles', Subsystem: 'Subsystems',
  CommonForm: 'CommonForms', CommonTemplate: 'CommonTemplates', CommonPicture: 'CommonPictures',
};

function exists(full) {
  const [type, name] = full.split('.');
  const dir = DIR[type];
  if (!dir || !name) return true;
  return fs.existsSync(path.join(tree, dir, name + '.xml')) || fs.existsSync(path.join(tree, dir, name));
}

let removed = 0, files = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!e.name.endsWith('.xml')) continue;
    let t;
    try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const before = t;
    t = t.replace(/[ \t]*<xr:Item[^>]*>([A-Za-z]+\.[^<]+)<\/xr:Item>\r?\n/g, (m, ref) => (exists(ref.trim()) ? m : (removed++, '')));
    t = t.replace(/[ \t]*<xr:Object>([A-Za-z]+\.[^<]+)<\/xr:Object>\r?\n/g, (m, ref) => (exists(ref.trim()) ? m : (removed++, '')));
    if (t !== before) { fs.writeFileSync(full, t); files++; }
  }
}
walk(tree);
console.log(JSON.stringify({ files, removed }));
