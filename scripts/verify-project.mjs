#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const required = ['README.md', 'CONTEST_DECLARATION.md', 'MCP_INTEGRATION.md', 'mcp-config.example.json', 'skills/mai-just-right/SKILL.md', 'core/index.mjs', 'server/mcp-client.mjs', 'app/page.tsx'];
for (const path of required) if (!existsSync(path) || !readFileSync(path, 'utf8').trim()) throw new Error(`Missing required file: ${path}`);
const hash = createHash('sha256').update(readFileSync('CONTEST_DECLARATION.md')).digest('hex');
if (hash !== 'cd28101bcb29cc8fb24b372fe91ce6b42c4a1487a54e01f7ade0c8c6a84241b7') throw new Error('The official CONTEST_DECLARATION.md was modified. Download its exact original again.');
const config = JSON.parse(readFileSync('mcp-config.example.json', 'utf8'));
const remote = config.mcpServers?.['mcd-mcp'];
if (remote?.url !== 'https://mcp.mcd.cn' || remote?.headers?.Authorization !== 'Bearer ${MCD_MCP_TOKEN}') throw new Error('MCP example must point to the official server and use the environment placeholder.');
const skill = readFileSync('skills/mai-just-right/SKILL.md', 'utf8');
if (!skill.startsWith('---\nname: mai-just-right\n')) throw new Error('Agent Skill metadata is missing.');
if (existsSync('workbuddy.md')) console.log('workbuddy.md is present; its authenticity requires review of actual WorkBuddy history.');
console.log('Required contest files, exact declaration, safe config and Skill metadata: passed.');

const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`);
const isolation = Number(process.versions.node.split('.')[0]) >= 24 ? ['--test-isolation=none'] : [];
const test = spawnSync(process.execPath, ['--test', ...isolation, '--test-reporter=spec', ...tests], { stdio: 'inherit' });
if (test.status !== 0) process.exit(test.status ?? 1);
if (!existsSync('node_modules/typescript/bin/tsc')) throw new Error('Install Web dependencies (npx --yes pnpm@11.25.0 install --frozen-lockfile) before the TypeScript check.');
const typecheck = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { stdio: 'inherit' });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);
console.log('TypeScript: passed. Live MCP account calls are not part of this offline verification.');
