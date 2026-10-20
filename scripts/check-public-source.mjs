#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('git', ['-c', `safe.directory=${root.replace(/[\\/]$/, '')}`, 'ls-files', '-z'], {
  cwd: root, windowsHide: true, encoding: 'utf8',
});
if (result.status !== 0) throw new Error('Cannot inspect the tracked public source.');
const files = result.stdout.split('\0').filter(Boolean);
const findings = [];
const known = ['MCD_MCP_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'OPENAI_API_KEY']
  .map(name => process.env[name]).filter(value => value && value.length >= 12);
for (const file of files) {
  const forbidden = /(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|PRIVATE_[^/]*|\.aws|\.ssh|node_modules|work|outputs|\.sites-runtime|\.wrangler)(\/|$)/i.test(file)
    || /\.(?:pem|key|p12|pfx)$/i.test(file)
    || file.startsWith('evidence/')
    || /(^|\/)[^/]*_debug_delivery[^/]*\.zip$/i.test(file);
  if (forbidden && file !== '.env.example') {
    findings.push({ path: file, rule: 'private-or-generated-file' });
    continue; // Never open a tracked .env or credential file, even by accident.
  }
  const bytes = readFileSync(new URL(file, new URL('../', import.meta.url)));
  const text = bytes.toString('utf8');
  if (known.some(value => bytes.includes(Buffer.from(value)))) findings.push({ path: file, rule: 'known-environment-secret' });
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{35,})\b/.test(text)
      || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) findings.push({ path: file, rule: 'credential-pattern' });
  if (file === '.env.example') {
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z_]*(?:TOKEN|KEY|SECRET|PASSWORD))=(.*)$/.exec(line.trim());
      if (match?.[2].trim()) findings.push({ path: file, rule: 'nonempty-example-credential' });
    }
  }
}
console.log(JSON.stringify({ trackedFiles: files.length, knownSecretValuesChecked: known.length, findings }, null, 2));
if (findings.length) process.exitCode = 1;
