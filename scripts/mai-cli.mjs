#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { planMeal, parseIntent, makeReceipt, scenarios } from '../core/index.mjs';
import { McdClient, integrationEvidence } from '../server/mcp-client.mjs';
import { compareOfficialQuotes } from '../server/quote-comparison.mjs';

if (typeof process.loadEnvFile === 'function') { try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
const [command = 'demo', ...args] = process.argv.slice(2);
const value = flag => { const index = args.indexOf(flag); if (index === -1) return undefined; const result = args[index + 1]; if (!result || result.startsWith('--')) throw new Error(`${flag} requires a value.`); return result; };
const has = flag => args.includes(flag);
const loadJson = async path => { const raw = await readFile(path, 'utf8'); if (Buffer.byteLength(raw) > 65536) throw new Error('Input exceeds 64 KiB.'); return JSON.parse(raw); };
const json = result => console.log(JSON.stringify(result, null, 2));

async function main() {
  if (has('--help') || command === 'help') {
    console.log(`麦麦刚刚好 CLI\n\nnode scripts/mai-cli.mjs demo [--json]\nnode scripts/mai-cli.mjs plan --input examples/intent.json [--json]\nnode scripts/mai-cli.mjs plan --text "30元，一个麦辣鸡腿堡、一份薯条、一杯可乐"\nnode scripts/mai-cli.mjs receipt --input examples/intent.json\nnode scripts/mai-cli.mjs mcp-check [--evidence path.json]\nnode scripts/mai-cli.mjs mcp-call --tool calculate-price --input PRIVATE_ARGUMENTS.json\nnode scripts/mai-cli.mjs mcp-quote --input PRIVATE_QUOTE_REQUEST.json\n\n真实账户命令从服务端环境变量 MCD_MCP_TOKEN 读取凭证；不要把凭证放进命令行。\n只有 mcp-check 的 --evidence 输出经过最小化处理；不要公开账户或核价原始结果。`);
    return;
  }
  if (['demo', 'plan', 'receipt'].includes(command)) {
    const input = value('--input') ? await loadJson(value('--input')) : value('--text') ? parseIntent(value('--text')) : scenarios[0];
    if (!input.items?.length) throw new Error('没有识别到明确餐品，请使用 --input 或明确写出餐品名称。');
    const plan = planMeal(input);
    if (has('--json')) json(plan); else console.log(makeReceipt(plan));
    return;
  }
  if (!['mcp-check', 'mcp-call', 'mcp-quote'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const client = new McdClient({ token: process.env.MCD_MCP_TOKEN });
  let outcome = 'failed';
  try {
    if (command === 'mcp-check') {
      const tools = await client.listTools();
      const snapshot = await client.snapshot();
      outcome = snapshot.results.some(row => !row.error) ? 'business-call-succeeded' : 'discovery-only';
      json({ ...snapshot, tools: tools.map(t => ({ name: t.name, readOnlyAllowed: t.readOnlyAllowed, inputSchema: t.inputSchema })), verification: outcome });
      if (outcome !== 'business-call-succeeded') process.exitCode = 2;
    }
    if (command === 'mcp-call') {
      if (!value('--tool') || !value('--input')) throw new Error('mcp-call requires --tool and --input.');
      json(await client.callTool(value('--tool'), await loadJson(value('--input'))));
      outcome = 'business-call-succeeded';
    }
    if (command === 'mcp-quote') {
      if (!value('--input')) throw new Error('mcp-quote requires --input using the actual runtime schema.');
      json(await compareOfficialQuotes(client, await loadJson(value('--input'))));
      outcome = 'quote-comparison-succeeded';
    }
  } finally {
    await client.close();
    if (value('--evidence')) {
      if (command !== 'mcp-check') throw new Error('--evidence is supported only for mcp-check.');
      await mkdir(dirname(value('--evidence')), { recursive: true });
      await writeFile(value('--evidence'), JSON.stringify(integrationEvidence(client, outcome), null, 2) + '\n', { mode: 0o600 });
    }
  }
}

main().catch(error => { console.error(JSON.stringify({ error: error.code ?? 'CLI_ERROR', message: error.message, ...(error.details ? { details: error.details } : {}) })); process.exitCode = 1; });
