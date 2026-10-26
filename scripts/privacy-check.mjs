// Scans the repository for strings that would tie it to a person or machine before publishing.
// Usage: node scripts/privacy-check.mjs [extra-term ...]
// Exit code 1 when anything is found. Add project-specific terms in scripts/privacy-terms.txt (one per line).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'release', '.expo', 'android', 'ios', '.gradle']);
const SKIP_FILES = new Set(['package-lock.json', 'privacy-terms.txt', 'privacy-allow.txt']);
const TEXT = /\.(md|ts|tsx|js|mjs|json|yml|yaml|css|html|txt|env|example)$/;

const terms = new Set([
  os.userInfo().username,
  os.hostname(),
  ...process.argv.slice(2),
]);
const termsFile = path.join(root, 'scripts', 'privacy-terms.txt');
if (fs.existsSync(termsFile)) for (const line of fs.readFileSync(termsFile, 'utf8').split(/\r?\n/)) if (line.trim() && !line.startsWith('#')) terms.add(line.trim());
terms.delete('');

// Business identity that is meant to be public (support email and the like) lives in scripts/privacy-allow.txt.
const allowed = new Set();
const allowFile = path.join(root, 'scripts', 'privacy-allow.txt');
if (fs.existsSync(allowFile)) for (const line of fs.readFileSync(allowFile, 'utf8').split(/\r?\n/)) if (line.trim() && !line.startsWith('#')) allowed.add(line.trim().toLowerCase());

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL = /@(example\.com|localhost|users\.noreply\.github\.com|anthropic\.com|openai\.com)$/i;
const HOME = /[A-Za-z]:\\Users\\(?!<|YOUR_|\$)[^\\\s"'`]+|\/home\/(?!<|YOUR_|\$)[^/\s"'`]+|\/Users\/(?!<|YOUR_|\$)[^/\s"'`]+/g;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termPatterns = [...terms].filter(t => t.length >= 3).map(t => ({ term: t, re: new RegExp(`(?<![A-Za-z0-9])${escape(t)}(?![A-Za-z0-9])`, 'i') }));

const findings = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) scan(full); continue; }
    if (SKIP_FILES.has(entry.name) || !TEXT.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const where = `${path.relative(root, full)}:${i + 1}`;
      for (const { term, re } of termPatterns) if (re.test(line)) findings.push(`${where}: contains "${term}"`);
      for (const m of line.matchAll(EMAIL)) if (!ALLOWED_EMAIL.test(m[0]) && !allowed.has(m[0].toLowerCase())) findings.push(`${where}: email ${m[0]}`);
      for (const m of line.matchAll(HOME)) findings.push(`${where}: home path ${m[0]}`);
    });
  }
}
scan(root);

if (findings.length) {
  console.error(`Privacy check: ${findings.length} finding(s)\n` + findings.map(f => `  ${f}`).join('\n'));
  process.exit(1);
}
console.log(`Privacy check: clean (${terms.size} terms, emails and home paths scanned).`);
