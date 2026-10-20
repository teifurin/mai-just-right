#!/usr/bin/env node
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Explicit source allowlist: .env, PRIVATE_*, evidence/, caches and credentials
// are never opened, copied or traversed. Load .env in the parent Node process
// only when checking known secrets against these public source files.
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(root, process.argv[2] ?? 'work/release-source');
const workRoot = path.join(root, 'work') + path.sep;
if (!destination.startsWith(workRoot)) throw new Error('Release output must be inside this project/work/.');
if (existsSync(destination) && readdirSync(destination).length) throw new Error('Use an empty release output directory; existing files are never deleted.');
const rootFiles = [
  'README.md', 'CONTEST_DECLARATION.md', 'MCP_INTEGRATION.md', 'mcp-config.example.json', 'LICENSE', 'SECURITY.md',
  '.env.example', '.gitignore', '.gitattributes', '.npmrc', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'tsconfig.json', 'next.config.ts', 'vite.config.ts', 'postcss.config.mjs',
  'eslint.config.mjs', 'cloudflare-env.d.ts',
];
const directories = ['app', 'build', 'core', 'docs', 'examples', 'patches', 'public', 'scripts', 'server', 'skills', 'tests', '.github'];
const files = [...rootFiles];
function walk(relative) {
  for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in release source: ${name}`);
    if (entry.name.startsWith('PRIVATE_')
        || (entry.name.startsWith('.env') && entry.name !== '.env.example')
        || /^\.dev\.vars(?:\.|$)/.test(entry.name)
        || /\.(?:pem|key|p12|pfx|sqlite3?|db)$/i.test(entry.name)
        || ['.git', '.aws', '.ssh', 'node_modules', '.sites-runtime'].includes(entry.name)) throw new Error(`Private file in a public source directory: ${name}`);
    if (entry.isDirectory()) walk(name);
    else if (entry.isFile()) files.push(name);
  }
}
directories.forEach(directory => { if (existsSync(path.join(root, directory))) walk(directory); });
for (const required of ['server/mcp-client.mjs', 'server/http-handler.mjs', 'server/quote-comparison.mjs', 'tests/engine.test.mjs', 'tests/mcp.test.mjs', 'tests/schema.test.mjs']) {
  if (!files.includes(required)) throw new Error(`Release allowlist omits required source: ${required}`);
}
const secretValues = ['MCD_MCP_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'OPENAI_API_KEY']
  .map(name => process.env[name]).filter(value => value && value.length >= 12);
const findings = [];
const manifest = [];
for (const relative of files.sort()) {
  const source = path.join(root, relative);
  if (!existsSync(source) || !lstatSync(source).isFile()) throw new Error(`Missing release file: ${relative}`);
  const bytes = readFileSync(source);
  const content = bytes.toString('utf8');
  if (secretValues.some(value => content.includes(value))
      || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/.test(content)
      || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push(relative);
  manifest.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
if (findings.length) throw new Error(`Potential credentials in release source; blocked paths only: ${findings.join(', ')}`);
for (const relative of files) {
  const output = path.join(destination, relative);
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(path.join(root, relative), output);
}
mkdirSync(path.join(destination, '.openai'), { recursive: true });
// Public clones must not inherit the original owner's private Sites identity.
writeFileSync(path.join(destination, '.openai/hosting.json'), JSON.stringify({ d1: null, r2: null }, null, 2) + '\n');
writeFileSync(path.join(destination, 'RELEASE_MANIFEST.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), includesCredentials: false,
  knownSecretValuesChecked: secretValues.length, files: manifest,
}, null, 2) + '\n');
console.log(JSON.stringify({ destination, sourceFiles: files.length + 2, credentialFindings: 0, knownSecretValuesChecked: secretValues.length }, null, 2));
