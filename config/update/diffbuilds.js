// Машинный diff двух manifest сборок.
// Использование: node diffbuilds.js <prevManifest.json> <currManifest.json> [report.json]
'use strict';
const fs = require('fs');
const [, , prevPath, currPath, reportPath] = process.argv;
if (!prevPath || !currPath) { console.error('usage: node diffbuilds.js <prevManifest> <currManifest> [report]'); process.exit(2); }
const load = (p) => {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const m = new Map();
  for (const f of (j.files || [])) m.set(f.path, f.sha1);
  return m;
};
const prev = load(prevPath);
const curr = load(currPath);
const added = [], removed = [], changed = [];
for (const [p, h] of curr) {
  if (!prev.has(p)) added.push(p);
  else if (prev.get(p) !== h) changed.push(p);
}
for (const p of prev.keys()) if (!curr.has(p)) removed.push(p);
const report = { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ added: added.length, removed: removed.length, changed: changed.length }));
console.log(JSON.stringify({ added: added.slice(0, 10), removed: removed.slice(0, 10), changed: changed.slice(0, 10) }, null, 1));
