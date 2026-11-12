// Объединение состава ОпределяемыхТипов с ПРИОРИТЕТОМ ТЕКУЩЕЙ конфигурации.
//
// Правило: ни один тип, заявленный в текущей конфигурации (конфигурации базы данных), не должен
// потеряться. Уменьшение состава ломает реструктуризацию непустой базы (на пустой — не проявляется).
//
// Порядок: сначала типы текущей конфигурации (как в БД), затем типы поставщика, которых нет.
// Переименования объектов учитываются по карте UUID-пар (необязательный аргумент renames.json).
//
// Использование:
//   node mergetypes.js <resultTree> <currentTree> [report.json] [--apply] [renames.json]
// Без --apply — только отчёт (dry run).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const positional = args.filter((a) => !a.startsWith('--'));
const [resultTree, currentTree, reportPath, renamesPath] = positional;
if (!resultTree || !currentTree) {
  console.error('usage: node mergetypes.js <resultTree> <currentTree> [report.json] [--apply] [renames.json]');
  process.exit(2);
}

const DIR = {
  DocumentRef: 'Documents', DocumentObject: 'Documents', DocumentSelection: 'Documents',
  CatalogRef: 'Catalogs', CatalogObject: 'Catalogs', CatalogSelection: 'Catalogs',
  EnumRef: 'Enums',
  InformationRegisterRef: 'InformationRegisters', InformationRegisterRecordSet: 'InformationRegisters',
  InformationRegisterRecordKey: 'InformationRegisters', InformationRegisterSelection: 'InformationRegisters',
  AccumulationRegisterRef: 'AccumulationRegisters', AccumulationRegisterRecordSet: 'AccumulationRegisters',
  AccumulationRegisterRecordKey: 'AccumulationRegisters', AccumulationRegisterSelection: 'AccumulationRegisters',
  AccountingRegisterRef: 'AccountingRegisters', AccountingRegisterRecordSet: 'AccountingRegisters',
  AccountingRegisterRecordKey: 'AccountingRegisters',
  CalculationRegisterRef: 'CalculationRegisters', CalculationRegisterRecordSet: 'CalculationRegisters',
  ChartOfCharacteristicTypesRef: 'ChartsOfCharacteristicTypes', ChartOfCharacteristicTypesObject: 'ChartsOfCharacteristicTypes',
  ChartOfCalculationTypesRef: 'ChartsOfCalculationTypes', ChartOfCalculationTypesObject: 'ChartsOfCalculationTypes',
  ChartOfAccountsRef: 'ChartsOfAccounts', ChartOfAccountsObject: 'ChartsOfAccounts',
  BusinessProcessRef: 'BusinessProcesses', BusinessProcessObject: 'BusinessProcesses',
  TaskRef: 'Tasks', TaskObject: 'Tasks',
  ExchangePlanRef: 'ExchangePlans', ExchangePlanObject: 'ExchangePlans',
  DocumentJournalRef: 'DocumentJournals',
  DefinedType: 'DefinedTypes', CommonModule: 'CommonModules', ConstantRef: 'Constants',
  ReportRef: 'Reports', ReportObject: 'Reports', DataProcessorRef: 'DataProcessors', DataProcessorObject: 'DataProcessors',
};

const renames = new Map();
function loadRenames(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const pair of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const oldN = String(pair[0]).split('.').pop();
    const newN = String(pair[1]).split('.').pop();
    if (oldN && newN) renames.set(oldN, newN);
  }
}
if (renamesPath) loadRenames(renamesPath);

function normalize(ref) {
  const t = ref.trim();
  const m = /^(cfg:)?([A-Za-z]+)\.([^.<]+)$/.exec(t);
  if (!m) return { ok: true, ref: t };
  const dir = DIR[m[2]];
  if (!dir) return { ok: true, ref: t };
  const name = m[3];
  if (fs.existsSync(path.join(resultTree, dir, name + '.xml'))) return { ok: true, ref: t };
  const alt = renames.get(name);
  if (alt && fs.existsSync(path.join(resultTree, dir, alt + '.xml'))) {
    return { ok: true, ref: (m[1] ? 'cfg:' : '') + m[2] + '.' + alt, renamedFrom: name };
  }
  return { ok: false, ref: t };
}

function typesOf(xml) {
  const block = /<Type>([\s\S]*?)<\/Type>/.exec(xml);
  if (!block) return [];
  return [...block[1].matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((m) => m[1].trim());
}

const report = { files: 0, addedFromCurrent: 0, appendedFromVendor: 0, skippedMissing: 0, renamed: 0, details: [] };
const defDir = path.join(resultTree, 'DefinedTypes');
const curDir = path.join(currentTree, 'DefinedTypes');
if (!fs.existsSync(defDir)) { console.log('нет DefinedTypes'); process.exit(0); }

for (const e of fs.readdirSync(defDir, { withFileTypes: true })) {
  if (!e.isFile() || !e.name.endsWith('.xml')) continue;
  const f = path.join(defDir, e.name);
  const curF = path.join(curDir, e.name);
  if (!fs.existsSync(curF)) continue;

  const xml = fs.readFileSync(f, 'utf8');
  const curXml = fs.readFileSync(curF, 'utf8');
  const base = typesOf(xml);
  const cur = typesOf(curXml);

  const out = [];
  const seen = new Set();
  const missing = [];
  let added = 0, renamed = 0;

  // 1) типы текущей конфигурации — в её порядке
  for (const t of cur) {
    const r = normalize(t);
    if (!r.ok) { missing.push(t); continue; }
    if (r.renamedFrom) renamed++;
    if (seen.has(r.ref)) continue;
    seen.add(r.ref); out.push(r.ref);
    if (!base.some((b) => b.trim() === r.ref)) added++;
  }
  // 2) типы поставщика, которых нет в текущей — в конец
  let appended = 0;
  for (const t of base) {
    const tt = t.trim();
    if (seen.has(tt)) continue;
    seen.add(tt); out.push(tt); appended++;
  }

  if (added || missing.length || appended) {
    report.files++;
    report.addedFromCurrent += added;
    report.appendedFromVendor += appended;
    report.skippedMissing += missing.length;
    report.renamed += renamed;
    report.details.push({ file: 'DefinedTypes/' + e.name, name: e.name.replace(/\.xml$/, ''),
      baseCount: base.length, curCount: cur.length, addedFromCurrent: added, appendedFromVendor: appended, missing });
  }

  if (apply && out.length) {
    // Добавляем только недостающие типы. Квалификаторы (<v8:StringQualifiers> и др.) НЕ трогаем:
    // их удаление делает тип недопустимым (проверено 20.10.2026: 86 «Недопустимый тип» + 200 «Неверный путь»).
    const m = /<Type>([\s\S]*?)<\/Type>/.exec(xml);
    if (!m) continue;
    const body = m[1];
    const existing = [...body.matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((x) => x[1].trim());
    const toAdd = out.filter((x) => !existing.includes(x));
    if (!toAdd.length) continue;
    const indent = (/\n([ \t]*)<v8:Type>/.exec(body) || [, '\t\t\t'])[1];
    const insertAt = body.lastIndexOf('</v8:Type>') + '</v8:Type>'.length;
    let addText = toAdd.map((x) => '\n' + indent + '<v8:Type>' + x + '</v8:Type>').join('');
    // Для добавляемых примитивных типов переносим квалификаторы из current (иначе «Недопустимый тип»).
    if (toAdd.some((x) => x.startsWith('xs:'))) {
      for (const q of ['StringQualifiers', 'NumberQualifiers', 'DateQualifiers']) {
        const qre = new RegExp('<v8:' + q + '[\\s\\S]*?</v8:' + q + '>');
        const cm = qre.exec(curXml);
        if (cm && !qre.test(body)) addText += '\n' + indent + cm[0];
      }
    }
    fs.writeFileSync(f, xml.replace(m[0], '<Type>' + body.slice(0, insertAt) + addText + body.slice(insertAt) + '</Type>'));
  }
}

if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ apply, files: report.files, addedFromCurrent: report.addedFromCurrent,
  appendedFromVendor: report.appendedFromVendor, skippedMissing: report.skippedMissing, renamed: report.renamed,
  top: report.details.sort((a, b) => b.addedFromCurrent - a.addedFromCurrent).slice(0, 8)
    .map((d) => [d.name, d.baseCount, d.curCount, d.addedFromCurrent, d.appendedFromVendor, d.missing.length]) }));
