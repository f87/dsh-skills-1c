// Удаление из Configuration.xml записей ChildObjects, для которых нет файла объекта.
// Использование: node fixconfig.js <tree>
const fs = require('fs');
const path = require('path');
const tree = process.argv[2];
const cfgPath = path.join(tree, 'Configuration.xml');
let cfg = fs.readFileSync(cfgPath, 'utf8');

const dirByType = {
  Catalog: 'Catalogs', Document: 'Documents', Enum: 'Enums', Report: 'Reports',
  DataProcessor: 'DataProcessors', InformationRegister: 'InformationRegisters',
  AccumulationRegister: 'AccumulationRegisters', AccountingRegister: 'AccountingRegisters',
  CalculationRegister: 'CalculationRegisters', ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes',
  ChartOfCalculationTypes: 'ChartsOfCalculationTypes', ChartOfAccounts: 'ChartsOfAccounts',
  BusinessProcess: 'BusinessProcesses', Task: 'Tasks', ExchangePlan: 'ExchangePlans',
  CommonModule: 'CommonModules', CommonForm: 'CommonForms', CommonTemplate: 'CommonTemplates',
  CommonPicture: 'CommonPictures', CommonCommand: 'CommonCommands', Constant: 'Constants',
  DefinedType: 'DefinedTypes', EventSubscription: 'EventSubscriptions', FilterCriterion: 'FilterCriteria',
  FunctionalOption: 'FunctionalOptions', Role: 'Roles', ScheduledJob: 'ScheduledJobs',
  Sequence: 'Sequences', SessionParameter: 'SessionParameters', StyleItem: 'StyleItems',
  Subsystem: 'Subsystems', WebService: 'WebServices', XDTOPackage: 'XDTOPackages',
  DocumentJournal: 'DocumentJournals', DocumentNumerator: 'DocumentNumerators',
  HTTPService: 'HTTPServices', WebSocketClient: 'WebSocketClients', ExternalDataSource: 'ExternalDataSources',
  SettingsStorage: 'SettingsStorages', Language: 'Languages', CommandGroup: 'CommandGroups',
};

let removed = 0;
const removedList = [];
cfg = cfg.replace(/\t*<([A-Za-z]+)>([^<]+)<\/\1>\r?\n/g, (m, tag, name) => {
  const dir = dirByType[tag];
  if (!dir) return m;
  for (const ext of ['.xml']) {
    const p = path.join(tree, dir, name + ext);
    if (fs.existsSync(p)) return m;
  }
  if (fs.existsSync(path.join(tree, dir, name))) return m;
  removed++;
  removedList.push(tag + '.' + name);
  return '';
});
fs.writeFileSync(cfgPath, cfg);
fs.writeFileSync(path.join(path.dirname(cfgPath), '..', '_work', 'reports', 'fixconfig.json'), JSON.stringify({ removed, removedList }, null, 1));
console.log(JSON.stringify({ removed, sample: removedList.slice(0, 10) }));
