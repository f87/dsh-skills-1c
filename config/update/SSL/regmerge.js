// Слияние регистрационных файлов: Predefined.xml (union элементов) и составов типов (<Type>/<v8:Type>).
// Использование: node regmerge.js <tree> <donorTree> <mode> <reportJson>
//   tree  - дерево результата (изменяется)
//   donor - дерево-донор (наша конфигурация или модуль)
//   mode  - 'predefined' | 'types' | 'all'
//   catalogs (6-й аргумент) - необязательный список каталогов для predefined через запятую
const fs = require('fs');
const path = require('path');

const [, , tree, donor, mode, reportPath, removedPath, catalogsCsv] = process.argv;
// каталоги, для которых объединяются Predefined.xml (через запятую); по умолчанию — каталоги доп. реквизитов и идентификаторов
const PREDEF_CATALOGS = (catalogsCsv || 'НаборыДополнительныхРеквизитовИСведений,ИдентификаторыОбъектовМетаданных')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (!reportPath) { console.error('usage: node regmerge.js <tree> <donorTree> <predefined|types|all> <report> [removedJson]'); process.exit(2); }

// фильтр ссылок на удалённые поставщиком объекты
const KIND = {
  DocumentRef: 'Document', DocumentObject: 'Document',
  CatalogRef: 'Catalog', CatalogObject: 'Catalog', CatalogSelection: 'Catalog',
  EnumRef: 'Enum',
  InformationRegisterRecordSet: 'InformationRegister', InformationRegisterRef: 'InformationRegister', InformationRegisterRecordKey: 'InformationRegister',
  AccumulationRegisterRecordSet: 'AccumulationRegister', AccumulationRegisterRef: 'AccumulationRegister',
  AccountingRegisterRecordSet: 'AccountingRegister',
  CalculationRegisterRecordSet: 'CalculationRegister',
  ChartOfCharacteristicTypesRef: 'ChartOfCharacteristicTypes',
  ChartOfCalculationTypesRef: 'ChartOfCalculationTypes',
  ChartOfAccountsRef: 'ChartOfAccounts',
  BusinessProcessRef: 'BusinessProcess', BusinessProcessObject: 'BusinessProcess',
  TaskRef: 'Task', TaskObject: 'Task',
  ExchangePlanRef: 'ExchangePlan', DocumentJournalRef: 'DocumentJournal',
};
let removed = new Set();
if (removedPath && fs.existsSync(removedPath)) {
  const list = JSON.parse(fs.readFileSync(removedPath, 'utf8'));
  removed = new Set(list.filter((n) => n.split('.').length === 2));
}
function referencesRemoved(typeText) {
  if (!removed.size) return false;
  const t = typeText.replace(/^[A-Za-z0-9_]+:/, '').trim(); // убираем префикс пространства имён
  const m = /^([A-Za-z]+)\.(.+)$/.exec(t);
  if (!m) return false;
  const kind = KIND[m[1]];
  if (!kind) return false;
  return removed.has(kind + '.' + m[2]);
}

const results = { predefinedFiles: 0, itemsAdded: 0, typeFiles: 0, typesAdded: 0, errors: [] };

// ---------- проверка существования объекта для предопределённых ----------
// Имена в ИдентификаторыОбъектовМетаданных кодируют вид и имя: «ДокументЗаказ» -> Document.Заказ.
const DIR = {
  Документ: 'Documents', Справочник: 'Catalogs', РегистрСведений: 'InformationRegisters',
  РегистрНакопления: 'AccumulationRegisters', РегистрБухгалтерии: 'AccountingRegisters',
  РегистрРасчета: 'CalculationRegisters', Перечисление: 'Enums', ПланОбмена: 'ExchangePlans',
  БизнесПроцесс: 'BusinessProcesses', Задача: 'Tasks', Отчет: 'Reports', Обработка: 'DataProcessors',
};
function objectExists(tree, name) {
  if (!name) return true;
  for (const [prefix, dir] of Object.entries(DIR)) {
    if (!name.startsWith(prefix)) continue;
    const obj = name.slice(prefix.length);
    if (!obj) return true;
    return fs.existsSync(path.join(tree, dir, obj + '.xml')) || fs.existsSync(path.join(tree, dir, obj));
  }
  return true; // вид не распознан — не фильтруем
}

// ---------- Predefined ----------
function splitItems(inner) {
  const items = [];
  let i = 0;
  while (i < inner.length) {
    const s = inner.indexOf('<Item ', i);
    if (s < 0) break;
    let depth = 0, j = s;
    while (j < inner.length) {
      const nextOpen = inner.indexOf('<Item ', j);
      const nextClose = inner.indexOf('</Item>', j);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) { depth++; j = nextOpen + 6; continue; }
      depth--;
      j = nextClose + 7;
      if (depth === 0) break;
    }
    items.push({ start: s, end: j, text: inner.slice(s, j) });
    i = j;
  }
  return items;
}

function itemName(block) {
  const m = /<Name>([^<]*)<\/Name>/.exec(block);
  return m ? m[1] : null;
}

function itemId(block) {
  const m = /<Item\s+id="([^"]+)"/.exec(block);
  return m ? m[1].toLowerCase() : null;
}

function mergePredefinedFile(file, donorFile, catalog) {
  let base = fs.readFileSync(file, 'utf8');
  const ours = fs.readFileSync(donorFile, 'utf8');
  const open = base.indexOf('<PredefinedData');
  const close = base.lastIndexOf('</PredefinedData>');
  if (open < 0 || close < 0) return;
  const innerStart = base.indexOf('>', open) + 1;
  let inner = base.slice(innerStart, close);
  const baseItems = splitItems(inner);
  const baseNames = new Set(baseItems.map((x) => itemName(x.text)).filter(Boolean));
  const baseIds = new Set(baseItems.map((x) => itemId(x.text)).filter(Boolean));

  const oOpen = ours.indexOf('<PredefinedData');
  const oClose = ours.lastIndexOf('</PredefinedData>');
  if (oOpen < 0 || oClose < 0) return;
  const oInner = ours.slice(ours.indexOf('>', oOpen) + 1, oClose);
  const ourItems = splitItems(oInner);

  let added = 0;
  const inserts = [];
  for (const it of ourItems) {
    const nm = itemName(it.text);
    const id = itemId(it.text);
    // Поставка главнее: не добавляем запись с тем же UUID или именем.
    if (!nm || !id || baseNames.has(nm) || baseIds.has(id) || (catalog === 'ИдентификаторыОбъектовМетаданных' && !objectExists(tree, nm))) {
      if (nm && baseNames.has(nm)) results.predefinedSkippedByName = (results.predefinedSkippedByName || 0) + 1;
      else if (nm && catalog === 'ИдентификаторыОбъектовМетаданных' && !objectExists(tree, nm)) results.predefinedSkippedOrphan = (results.predefinedSkippedOrphan || 0) + 1;
      else if (id && baseIds.has(id)) results.predefinedSkippedById = (results.predefinedSkippedById || 0) + 1;
      continue;
    }
    inserts.push(it.text);
    baseIds.add(id);
    baseNames.add(nm);
    added++;
  }
  if (!added) return;
  let newInner = inner;
  for (const t of inserts) newInner += '\t' + t + '\n';
  base = base.slice(0, innerStart) + newInner + base.slice(close);
  fs.writeFileSync(file, base);
  results.predefinedFiles++;
  results.itemsAdded += added;
}

// ---------- Type lists ----------
function typeBlocks(text) {
  const blocks = [];
  let i = 0;
  while (true) {
    const s = text.indexOf('<Type>', i);
    if (s < 0) break;
    const e = text.indexOf('</Type>', s);
    if (e < 0) break;
    blocks.push({ start: s, end: e + 7, inner: text.slice(s + 6, e) });
    i = e + 7;
  }
  return blocks;
}

function typeSet(inner) {
  const set = new Set();
  const re = /<v8:Type>([\s\S]*?)<\/v8:Type>/g;
  let m;
  while ((m = re.exec(inner)) !== null) set.add(m[1].trim());
  return set;
}

function mergeTypesFile(file, donorFile) {
  let base = fs.readFileSync(file, 'utf8');
  const ours = fs.readFileSync(donorFile, 'utf8');
  const bb = typeBlocks(base);
  const ob = typeBlocks(ours);
  if (!bb.length || !ob.length) return;
  let added = 0;
  // обрабатываем с конца, чтобы не сбить индексы
  for (let k = Math.min(bb.length, ob.length) - 1; k >= 0; k--) {
    const bSet = typeSet(bb[k].inner);
    const missing = [];
    for (const t of typeSet(ob[k].inner)) {
      if (bSet.has(t)) continue;
      if (referencesRemoved(t)) { results.typesSkippedRemoved = (results.typesSkippedRemoved || 0) + 1; continue; }
      missing.push(t);
    }
    if (!missing.length) continue;
    const closing = bb[k].end - 7; // позиция '</Type>'
    const text = base;
    const ins = missing.map((t) => '\t\t\t\t<v8:Type>' + t + '</v8:Type>\n').join('');
    base = text.slice(0, closing) + ins + text.slice(closing);
    added += missing.length;
  }
  if (added) {
    fs.writeFileSync(file, base);
    results.typeFiles++;
    results.typesAdded += added;
  }
}

function walk(dir, rel, cb) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, cb);
    else cb(path.join(dir, e.name), r);
  }
}

const modeWanted = (m) => mode === 'all' || mode === m;

if (modeWanted('predefined')) {
  walk(tree, '', (file, rel) => {
    // объединяем предопределённые только там, где от них зависят ссылки наших объектов
    const parts = rel.split('/');
    if (parts[0] !== 'Catalogs' || parts[2] !== 'Ext' || parts[3] !== 'Predefined.xml' || !PREDEF_CATALOGS.includes(parts[1])) return;
    const d = path.join(donor, rel);
    if (!fs.existsSync(d)) return;
    try { mergePredefinedFile(file, d, parts[1]); } catch (e) { results.errors.push(rel + ': ' + e.message); }
  });
}

if (modeWanted('types')) {
  walk(tree, '', (file, rel) => {
    // только файлы объектов: <Категория>/<Имя>.xml (вложенные Forms/Ext/Templates не трогаем)
    // Составы типов сливаем только для DefinedTypes: там ровно один блок <Type>,
    // для ПВХ/критериев отбора порядок блоков не гарантирован (риск вставки в чужой <Type>).
    if (!/^DefinedTypes\/[^/]+\.xml$/.test(rel)) return;
    const d = path.join(donor, rel);
    if (!fs.existsSync(d)) return;
    try { mergeTypesFile(file, d); } catch (e) { results.errors.push(rel + ': ' + e.message); }
  });
}

fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
