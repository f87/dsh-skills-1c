// Перенос наших изменений в файлах объектов на новую версию модуля.
// Использование: node reapply-changes.js <changedJson> <oldTree> <newTree> <curTree> <resTree> <reportJson>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [, , changedPath, oldTree, newTree, curTree, resTree, reportPath] = process.argv;
const changed = JSON.parse(fs.readFileSync(changedPath, 'utf8'));
const scripts = __dirname;

const report = { bslMerged: 0, objMerged: 0, tookOurs: 0, keptNew: 0, missing: 0, conflicts: [] };

function norm(s) { return s.replace(/\r\n/g, '\n'); }

for (const rel of changed) {
  const o = path.join(oldTree, rel);
  const n = path.join(newTree, rel);
  const c = path.join(curTree, rel);
  const r = path.join(resTree, rel);
  if (!fs.existsSync(c)) continue;
  if (!fs.existsSync(n)) {
    // поставщик убрал файл, но у нас он изменён — оставляем наш
    if (fs.existsSync(r)) continue;
    fs.mkdirSync(path.dirname(r), { recursive: true });
    fs.copyFileSync(c, r);
    report.tookOurs++;
    continue;
  }
  const nTxt = fs.readFileSync(n, 'utf8');
  const oTxt = fs.existsSync(o) ? fs.readFileSync(o, 'utf8') : '';
  const cTxt = fs.readFileSync(c, 'utf8');

  if (rel.endsWith('.bsl') && fs.existsSync(o)) {
    try {
      const out = execFileSync('node', [path.join(scripts, 'merge3v2.js'), n, o, c, r], { encoding: 'utf8' });
      report.bslMerged++;
    } catch (e) { report.conflicts.push({ rel, err: String(e).slice(0, 200) }); }
    continue;
  }
  if (false && rel.endsWith('.xml') && (rel.split('/').length === 2) && fs.existsSync(o)) {
    try {
      execFileSync('node', [path.join(scripts, 'objmerge.js'), n, o, c, r], { encoding: 'utf8' });
      report.objMerged++;
    } catch (e) { report.conflicts.push({ rel, err: String(e).slice(0, 200) }); }
    continue;
  }
  // прочее: если поставщик файл не менял — берём наш
  if (fs.existsSync(o) && norm(oTxt) === norm(nTxt)) {
    fs.copyFileSync(c, r);
    report.tookOurs++;
  } else {
    report.keptNew++;
    report.conflicts.push({ rel, reason: 'both changed' });
  }
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ bslMerged: report.bslMerged, objMerged: report.objMerged, tookOurs: report.tookOurs, keptNew: report.keptNew, conflicts: report.conflicts.length }));
