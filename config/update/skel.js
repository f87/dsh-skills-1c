// Каркас результата v3: тип-осознанное копирование объектов донора.
// Использование: node skel.js <baseManifest> <donorManifest> <donorTree> <outTree> <excludeJson|none> <reportJson>
const fs = require('fs');
const path = require('path');

const [, , baseManifestPath, donorManifestPath, donorTree, outTree, excludePath, reportPath] = process.argv;
if (!reportPath) {
  console.error('usage: node skel.js <baseManifest> <donorManifest> <donorTree> <outTree> <excludeJson|none> <reportJson>');
  process.exit(2);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const base = readJson(baseManifestPath);
const donor = readJson(donorManifestPath);
const exclude = excludePath && excludePath !== 'none' ? new Set(readJson(excludePath)) : new Set();
const baseNames = new Set(base.map((e) => e.n));

const isTop = (n) => n.split('.').length === 2;
const isSubChain = (n) => /^Subsystem\.[^.]+(?:\.Subsystem\.[^.]+)+$/.test(n);

// тип -> каталог, по корневому тегу объектов
const typeToDir = new Map();
const dirToType = new Map();
for (const d of fs.readdirSync(donorTree, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === 'Ext') continue;
  const full = path.join(donorTree, d.name);
  const files = fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.xml'));
  for (const f of files.slice(0, 5)) {
    const head = fs.readFileSync(path.join(full, f.name), 'utf8').slice(0, 4000);
    const m = /<([A-Za-z]+)\s+uuid="/.exec(head);
    if (m) {
      dirToType.set(d.name, m[1]);
      if (!typeToDir.has(m[1])) typeToDir.set(m[1], d.name);
      break;
    }
  }
}

const copied = [];
const missing = [];
const typeMismatch = [];

function copyObject(type, name) {
  const dir = typeToDir.get(type);
  if (!dir) return false;
  const relFile = path.join(dir, name + '.xml');
  const relDir = path.join(dir, name);
  const srcFile = path.join(donorTree, relFile);
  const srcDir = path.join(donorTree, relDir);
  let ok = false;
  if (fs.existsSync(srcFile)) {
    fs.mkdirSync(path.join(outTree, dir), { recursive: true });
    fs.copyFileSync(srcFile, path.join(outTree, relFile));
    const head = fs.readFileSync(srcFile, 'utf8').slice(0, 4000);
    const m = /<([A-Za-z]+)\s+uuid="/.exec(head);
    if (!m || m[1] !== type) typeMismatch.push({ name, expected: type, actual: m ? m[1] : null });
    ok = true;
  }
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, path.join(outTree, relDir), { recursive: true });
    ok = true;
  }
  return ok;
}

for (const e of donor) {
  const n = e.n;
  if (!isTop(n)) continue;
  if (baseNames.has(n) || exclude.has(n)) continue;
  const [type, name] = n.split('.');
  if (copyObject(type, name)) copied.push(n); else missing.push(n);
}

for (const e of donor) {
  const n = e.n;
  if (!isSubChain(n)) continue;
  if (baseNames.has(n) || exclude.has(n)) continue;
  const parts = n.split('.');
  const relParts = [];
  for (let i = 0; i < parts.length; i += 2) relParts.push('Subsystems', parts[i + 1]);
  const relBase = relParts.join(path.sep);
  const srcFile = path.join(donorTree, relBase + '.xml');
  const srcDir = path.join(donorTree, relBase);
  let ok = false;
  if (fs.existsSync(srcFile)) {
    fs.mkdirSync(path.dirname(path.join(outTree, relBase)), { recursive: true });
    fs.copyFileSync(srcFile, path.join(outTree, relBase + '.xml'));
    ok = true;
  }
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, path.join(outTree, relBase), { recursive: true });
    ok = true;
  }
  if (ok) copied.push(n); else missing.push(n);
}

const report = { copied: copied.length, missing: missing.length, typeMismatch, typeToDir: Object.fromEntries(typeToDir), copiedNames: copied };
fs.writeFileSync(reportPath, JSON.stringify({ ...report, copiedNames: undefined }, null, 1));
fs.writeFileSync(reportPath.replace(/\.json$/, '-names.json'), JSON.stringify(copied));
console.log(JSON.stringify({ copied: copied.length, missing: missing.length, typeMismatch: typeMismatch.length, types: typeToDir.size }));
