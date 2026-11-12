// Хэш-диф результата с поставкой ЕРП: каждое отличие должно быть в ожидаемом списке.
// Использование: node checkvendorchanges.js <resultTree> <updateErpTree> <expected-changed-files> [report.json]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [, , resultTree, updateTree, expectedPath, reportPath] = process.argv;
if (!resultTree || !updateTree || !expectedPath) {
  console.error('usage: node checkvendorchanges.js <result> <update> <expected-changed-files> [report]');
  process.exit(2);
}

const expected = new Set();
const lines = fs.readFileSync(expectedPath, 'utf8').split(/\r?\n/).filter(Boolean);
for (const line of lines) {
  const parts = line.split('\t');
  const p = (parts.length >= 2 ? parts[parts.length - 1] : line).replace(/\\/g, '/').trim();
  if (p) expected.add(p);
}
const sha1 = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

const report = { identical: 0, modified: [], unexpectedModified: [], systemChanged: [], missing: [], expectedNotSeen: [] };
const SYSTEM = new Set(['Configuration.xml', 'Ext/ParentConfigurations.bin', 'Ext/ManagedApplicationModule.bsl', 'Ext/SessionModule.bsl']);
function walk(dir, rel) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { walk(dir, r); continue; }
    if (e.name === 'ConfigDumpInfo.xml') continue;
    const src = path.join(updateTree, r);
    const dst = path.join(resultTree, r);
    if (!fs.existsSync(dst)) { report.missing.push(r); continue; }
    if (sha1(src) === sha1(dst)) { report.identical++; continue; }
    if (SYSTEM.has(r)) report.systemChanged.push(r);
    else if (expected.has(r)) report.modified.push(r);
    else report.unexpectedModified.push(r);
  }
}
walk(updateTree, '');
for (const p of expected) {
  if (!fs.existsSync(path.join(updateTree, p))) report.expectedNotSeen.push(p);
}
const out = {
  identical: report.identical,
  modified: report.modified.length,
  systemChanged: report.systemChanged.length,
  unexpectedModified: report.unexpectedModified.length,
  missing: report.missing.length,
  expectedNotSeen: report.expectedNotSeen.length,
  samples: {
    unexpectedModified: report.unexpectedModified.slice(0, 10),
    missing: report.missing.slice(0, 10),
    expectedNotSeen: report.expectedNotSeen.slice(0, 10),
  },
};
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ ...out, details: report }, null, 1));
console.log(JSON.stringify(out));
process.exit(out.unexpectedModified || out.missing ? 1 : 0);
