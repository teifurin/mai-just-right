#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { McdClient, integrationEvidence } from '../server/mcp-client.mjs';
import { compareOfficialQuotes } from '../server/quote-comparison.mjs';

// Node loads the environment for the script; credentials and raw account
// responses are never included in stdout or the evidence file.
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot load local environment.'); }
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a path.`);
  return args[index + 1];
}
let client;
try {
  client = new McdClient({ token: process.env.MCD_MCP_TOKEN });
  const tools = await client.listTools();
  const snapshot = await client.snapshot();
  const succeeded = snapshot.results.filter(row => !row.error);
  let quotes;
  const quoteInput = option('--quote-input');
  if (quoteInput) {
    const raw = await readFile(quoteInput, 'utf8');
    if (Buffer.byteLength(raw) > 65536) throw new Error('Quote input exceeds 64 KiB.');
    const request = JSON.parse(raw.replace(/^\uFEFF/, ''));
    // Generic labels prevent caller-supplied titles from leaking personal data.
    request.baseline.title = 'baseline';
    request.candidates.forEach((candidate, index) => { candidate.title = `candidate-${index + 1}`; });
    quotes = await compareOfficialQuotes(client, request);
  }
  const evidence = {
    ...integrationEvidence(client, succeeded.length ? 'business-call-succeeded' : 'discovery-only'),
    toolsDiscovered: tools.length,
    readOnlyTools: tools.filter(tool => tool.readOnlyAllowed).length,
    successfulSnapshotQueries: succeeded.map(row => row.tool),
    ...(quotes ? { quotes } : {}),
  };
  const output = option('--evidence');
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (!succeeded.length) process.exitCode = 2;
} catch (error) {
  // Print only known error codes, never upstream response or credential text.
  console.error(JSON.stringify({ error: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'LIVE_VERIFICATION_FAILED' }));
  process.exitCode = 1;
} finally { await client?.close(); }
