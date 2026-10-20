import test from 'node:test';
import assert from 'node:assert/strict';
import { McdClient, MCD_ENDPOINT, readRpcResponse, integrationEvidence } from '../server/mcp-client.mjs';
import { validateArguments, assertPlainArguments } from '../server/schema.mjs';
import { compareOfficialQuotes, moneyToCents } from '../server/quote-comparison.mjs';
import { handleMcpRequest, mcpStatus } from '../server/http-handler.mjs';

const TEST_TOKEN = 'unit-test-only-not-a-credential';
const TRUSTED_OWNER_ENV = { MCD_TRUST_SITES_IDENTITY: '1', MCD_OWNER_USER_ID: 'test-user' };
const jsonResponse = (id, result, extra = {}) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json', ...extra } });
function fakeServer({ tools = [{ name: 'now-time-info', inputSchema: { type: 'object', additionalProperties: false } }], handle = undefined } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, MCD_ENDPOINT);
    requests.push(init);
    if (init.method === 'DELETE') return new Response(null, { status: 405 });
    const body = JSON.parse(init.body);
    if (handle) { const response = await handle(body, init, requests); if (response) return response; }
    if (body.method === 'initialize') return jsonResponse(body.id, { protocolVersion: '2025-06-18', serverInfo: { name: 'test-fixture', version: '1' }, capabilities: { tools: {} } }, { 'Mcp-Session-Id': 'test-session' });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/list') return jsonResponse(body.id, { tools });
    if (body.method === 'tools/call') return jsonResponse(body.id, { content: [{ type: 'text', text: '{"date":"2026-10-17"}' }] });
    throw new Error('Unexpected request');
  };
  return { client: new McdClient({ token: TEST_TOKEN, fetchImpl }), requests, fetchImpl };
}

test('performs initialize + notification + discovery before a business call and sends session/version', async () => {
  const { client, requests } = fakeServer();
  const result = await client.callTool('now-time-info', {});
  assert.equal(result.source, 'live');
  assert.deepEqual(requests.map(r => JSON.parse(r.body).method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.equal(requests[3].headers['Mcp-Session-Id'], 'test-session');
  assert.equal(requests[3].headers['MCP-Protocol-Version'], '2025-06-18');
  assert.equal(requests[3].headers.Accept, 'application/json, text/event-stream');
  assert.equal(requests[3].redirect, 'manual');
  assert.equal(JSON.stringify(client).includes(TEST_TOKEN), false);
  await client.close();
  assert.equal(requests.at(-1).method, 'DELETE');
  assert.equal(requests.at(-1).redirect, 'manual');
});

test('redirects stop at the official endpoint without forwarding credentials in Workers or Node', async () => {
  const { client, requests } = fakeServer({ handle: (_body, init) => {
    // Emulate Workers' supported redirect modes: "error" fails before networking.
    if (!['follow', 'manual'].includes(init.redirect)) throw new TypeError('Invalid redirect mode');
    assert.equal(init.redirect, 'manual');
    return new Response(TEST_TOKEN, { status: 302, headers: { Location: 'https://untrusted.invalid/collect' } });
  } });
  await assert.rejects(() => client.listTools(), error => error.code === 'UPSTREAM_REDIRECT' && !error.message.includes(TEST_TOKEN));
  assert.equal(requests.length, 1);
  assert.equal(client.audit.at(-1).ok, false);
});

test('parses chunked SSE, CRLF, multibyte data, progress notifications and an open stream', async () => {
  const encoded = new TextEncoder().encode('event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0","id":7,"result":{"text":"优惠券"}}\r\n\r\n');
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i += 5) controller.enqueue(encoded.slice(i, i + 5)); }, cancel() { cancelled = true; } });
  const result = await readRpcResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), 7);
  assert.deepEqual(result, { text: '优惠券' });
  assert.equal(cancelled, true);
});

test('rejects mismatched JSON RPC ids and oversized responses', async () => {
  await assert.rejects(() => readRpcResponse(jsonResponse(8, {}), 7), { code: 'MISSING_RESPONSE' });
  await assert.rejects(() => readRpcResponse(new Response('x'.repeat(2 * 1024 * 1024 + 1)), 1), { code: 'RESPONSE_TOO_LARGE' });
});

test('forbids account mutations before contacting the server', async () => {
  const { client, requests } = fakeServer();
  for (const name of ['create-order', 'auto-bind-coupons', 'draw-lottery', 'mall-create-order', 'cancel-order', 'unknown']) await assert.rejects(() => client.callTool(name, {}), { code: 'TOOL_NOT_ALLOWED' });
  assert.equal(requests.length, 0);
});

test('validates runtime schema without guessing required fields', async () => {
  const { client, requests } = fakeServer({ tools: [{ name: 'calculate-price', inputSchema: { type: 'object', required: ['actualStoreCode'], properties: { actualStoreCode: { type: 'string' } }, additionalProperties: false } }] });
  await assert.rejects(() => client.callTool('calculate-price', {}), { code: 'SCHEMA_MISMATCH' });
  assert.equal(requests.some(r => JSON.parse(r.body).method === 'tools/call'), false);
  const result = await client.callTool('calculate-price', { actualStoreCode: 'fixture-only' });
  assert.equal(result.source, 'live');
});

test('authentication errors never leak bodies or credentials', async () => {
  const { client } = fakeServer({ handle: () => new Response(TEST_TOKEN, { status: 401 }) });
  await assert.rejects(() => client.listTools(), error => error.code === 'AUTH_FAILED' && !error.message.includes(TEST_TOKEN));
});

test('rate limiting fails clearly without an automatic request storm', async () => {
  const { client, requests } = fakeServer({ handle: () => new Response(null, { status: 429 }) });
  await assert.rejects(() => client.listTools(), { code: 'RATE_LIMITED' });
  assert.equal(requests.length, 1);
});

test('unexpected server protocol is rejected', async () => {
  const { client } = fakeServer({ handle: body => body.method === 'initialize' ? jsonResponse(body.id, { protocolVersion: '2099-01-01' }) : undefined });
  await assert.rejects(() => client.listTools(), { code: 'UNSUPPORTED_PROTOCOL' });
});

test('tools/list paginates and repeated cursors are rejected', async () => {
  const { client } = fakeServer({ handle: body => body.method === 'tools/list' ? jsonResponse(body.id, { tools: [], nextCursor: 'same' }) : undefined });
  await assert.rejects(() => client.listTools(), { code: 'INVALID_CURSOR' });
});

test('expired session is initialized once more before retrying a read-only request', async () => {
  let first = true;
  const { client, requests } = fakeServer({ handle: body => { if (body.method === 'tools/call' && first) { first = false; return new Response(null, { status: 404 }); } } });
  await client.callTool('now-time-info', {});
  assert.equal(requests.filter(r => JSON.parse(r.body).method === 'initialize').length, 2);
});

test('tool-level errors cannot be recorded as successful business evidence', async () => {
  const { client } = fakeServer({ handle: body => body.method === 'tools/call' ? jsonResponse(body.id, { isError: true, content: [{ type: 'text', text: TEST_TOKEN }] }) : undefined });
  await assert.rejects(() => client.callTool('now-time-info'), { code: 'TOOL_ERROR' });
  const evidence = integrationEvidence(client, 'failed');
  assert.equal(evidence.liveBusinessCallSucceeded, false);
  assert.equal(JSON.stringify(evidence).includes(TEST_TOKEN), false);
});

test('official business success=false fails closed even when MCP isError is false', async () => {
  for (const result of [
    { isError: false, structuredContent: { success: false, code: 500, message: TEST_TOKEN, data: { price: 0 } } },
    { isError: false, content: [{ type: 'text', text: JSON.stringify({ success: false, message: TEST_TOKEN }) }] },
  ]) {
    const { client } = fakeServer({ handle: body => body.method === 'tools/call' ? jsonResponse(body.id, result) : undefined });
    await assert.rejects(() => client.callTool('now-time-info'), error => error.code === 'TOOL_ERROR' && !error.message.includes(TEST_TOKEN));
    assert.equal(integrationEvidence(client, 'failed').liveBusinessCallSucceeded, false);
  }
});

test('null and malformed tool envelopes never count as successful business calls', async () => {
  for (const result of [null, 'ok', [], {}, { content: 'wrong-type' }]) {
    const { client } = fakeServer({ handle: body => body.method === 'tools/call' ? jsonResponse(body.id, result) : undefined });
    await assert.rejects(() => client.callTool('now-time-info'), { code: 'INVALID_TOOL_RESULT' });
    assert.equal(integrationEvidence(client, 'failed').liveBusinessCallSucceeded, false);
  }
});

test('server ping with same numeric ID receives a response while client keeps waiting', async () => {
  let answered = false;
  const { client, requests } = fakeServer({ handle: body => {
    if (!body.method && Object.hasOwn(body, 'result')) { assert.deepEqual(body.result, {}); answered = true; return new Response(null, { status: 202 }); }
    if (body.method === 'tools/call') return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, method: 'ping' })}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'pong acknowledged' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await client.callTool('now-time-info');
  assert.equal(result.source, 'live');
  assert.equal(answered, true);
  const reply = requests.find(r => !JSON.parse(r.body).method);
  assert.equal(reply.headers['Mcp-Session-Id'], 'test-session');
  assert.equal(client.audit.filter(row => row.method === 'tools/call').length, 1);
});

test('snapshot skips unknown required args and performs only documented queries', async () => {
  const { client } = fakeServer({ tools: [{ name: 'query-my-coupons', inputSchema: { type: 'object', required: ['scope'] } }, { name: 'now-time-info', inputSchema: { type: 'object' } }] });
  const snapshot = await client.snapshot();
  assert.equal(snapshot.results.length, 1);
  assert.equal(snapshot.results[0].tool, 'now-time-info');
  assert.equal(snapshot.skipped.find(r => r.name === 'query-my-coupons').reason, '需按实时 Schema 填写参数');
});

test('schema validator covers references, object/array requirements, enums and exact variants', () => {
  const schema = { type: 'object', required: ['items'], properties: { items: { type: 'array', minItems: 1, items: { $ref: '#/$defs/item' } } }, additionalProperties: false, $defs: { item: { type: 'object', required: ['quantity'], properties: { quantity: { type: 'integer', minimum: 1 } } } } };
  assert.deepEqual(validateArguments({ items: [{ quantity: 1 }] }, schema), []);
  assert.ok(validateArguments({ items: [{ quantity: 0 }] }, schema).length);
  assert.ok(validateArguments({ items: [], added: 1 }, schema).length);
  assert.ok(validateArguments('x', { enum: ['y'] }).length);
  assert.ok(validateArguments(1, { oneOf: [{ type: 'number' }, { type: 'integer' }] }).length);
});

test('plain args reject hostile or non-finite data before JSON transmission', () => {
  assert.throws(() => assertPlainArguments(JSON.parse('{"__proto__":{"admin":true}}')));
  assert.throws(() => assertPlainArguments({ price: NaN }));
  assert.throws(() => assertPlainArguments([]));
  assert.throws(() => assertPlainArguments({ text: 'a'.repeat(65537) }));
});

test('official quote money uses explicit units and exact cents', () => {
  assert.equal(moneyToCents('19.90', 'yuan'), 1990);
  assert.equal(moneyToCents(19.9, 'yuan'), 1990);
  assert.equal(moneyToCents(1990, 'fen'), 1990);
  for (const v of ['-1', '9.999', '1e3', undefined, '¥19.90']) assert.throws(() => moneyToCents(v, 'yuan'));
  assert.throws(() => moneyToCents(19.9, 'fen'));
  assert.throws(() => moneyToCents(20, 'auto'));
});

test('official comparison calls real adapter sequentially and compares payable totals', async () => {
  const calls = [];
  const client = { async callTool(name, args) { calls.push(args); return { fetchedAt: '2026-10-17T00:00:00Z', result: { structuredContent: { actual: { due: args.fixtureTotal } } } }; } };
  const result = await compareOfficialQuotes(client, { totalPath: ['actual', 'due'], unit: 'yuan', baseline: { title: 'baseline', arguments: { fixtureTotal: '40.00' } }, candidates: [{ title: 'coupon', extraCount: 0, arguments: { fixtureTotal: '25.90' } }, { title: 'upsell', extraCount: 2, arguments: { fixtureTotal: '35.00' } }] });
  assert.equal(calls.length, 3);
  assert.equal(result.source, 'live');
  assert.equal(result.best.savingCents, 1410);
  assert.equal(result.best.title, 'coupon');
});

test('comparison retains baseline when every promotion costs more', async () => {
  const client = { async callTool(name, args) { return { result: { content: [{ type: 'text', text: JSON.stringify({ due: args.price }) }] } }; } };
  const result = await compareOfficialQuotes(client, { totalPath: ['due'], unit: 'fen', baseline: { title: 'baseline', arguments: { price: 1000 } }, candidates: [{ title: 'more food', extraCount: 2, arguments: { price: 1200 } }] });
  assert.equal(result.best.title, 'baseline');
  assert.equal(result.best.savingCents, 0);
});

test('missing live price fails closed; no mock fallback', async () => {
  const client = { async callTool() { return { result: { structuredContent: { other: 1 } } }; } };
  await assert.rejects(() => compareOfficialQuotes(client, { totalPath: ['due'], unit: 'yuan', baseline: { title: 'base', arguments: {} }, candidates: [{ title: 'offer', arguments: {} }] }), { code: 'INVALID_PRICE' });
});

function apiRequest(body, headers = {}, url = 'https://private.example/api/mcp') { return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }); }

test('API requires authentication for hosted account queries', async () => {
  const res = await handleMcpRequest(apiRequest({ action: 'discover' }));
  assert.equal(res.status, 401);
});

test('API rejects cross-origin request even if identity is present', async () => {
  const res = await handleMcpRequest(apiRequest({ action: 'discover' }, { 'oai-authenticated-user-id': 'test-user', Origin: 'https://evil.example' }), TRUSTED_OWNER_ENV);
  assert.equal(res.status, 403);
});

test('API reports unconfigured token without claiming successful real access', async () => {
  const res = await handleMcpRequest(apiRequest({ action: 'discover' }, { 'oai-authenticated-user-id': 'test-user' }), TRUSTED_OWNER_ENV);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'TOKEN_REQUIRED');
  const status = await mcpStatus({}).json();
  assert.equal(status.configured, false);
  assert.equal(status.liveVerified, false);
});

test('API validates JSON and request size and does not call MCP for invalid requests', async () => {
  const auth = { 'oai-authenticated-user-id': 'test-user' };
  assert.equal((await handleMcpRequest(apiRequest('{invalid', auth), TRUSTED_OWNER_ENV)).status, 400);
  assert.equal((await handleMcpRequest(apiRequest({ action: 'discover', value: 'x'.repeat(66000) }, auth), TRUSTED_OWNER_ENV)).status, 413);
  assert.equal((await handleMcpRequest(apiRequest({ action: 'create-order' }, auth), TRUSTED_OWNER_ENV)).status, 400);
});

test('API discovery exposes only the allowlist and closes its session', async () => {
  const fixture = fakeServer({ tools: [{ name: 'now-time-info' }, { name: 'create-order' }] });
  const res = await handleMcpRequest(apiRequest({ action: 'discover' }, { 'oai-authenticated-user-id': 'test-user' }), { ...TRUSTED_OWNER_ENV, MCD_MCP_TOKEN: TEST_TOKEN }, () => fixture.client);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.tools.map(t => t.name), ['now-time-info']);
  assert.equal(body.hiddenWriteTools, 1);
  assert.equal(fixture.requests.at(-1).method, 'DELETE');
  assert.equal(JSON.stringify(body).includes(TEST_TOKEN), false);
});

test('localhost opt-in is explicit and does not apply to remote hosts', async () => {
  const local = await handleMcpRequest(apiRequest({ action: 'discover' }, {}, 'http://localhost:5173/api/mcp'), { MCD_ALLOW_LOCAL: '1' });
  assert.equal(local.status, 503);
  const remote = await handleMcpRequest(apiRequest({ action: 'discover' }), { MCD_ALLOW_LOCAL: '1' });
  assert.equal(remote.status, 401);
  const forged = await handleMcpRequest(apiRequest({ action: 'discover' }, { 'oai-authenticated-user-id': 'forged' }, 'http://localhost:5173/api/mcp'), {});
  assert.equal(forged.status, 401);
});

test('snapshot cannot show verified success when all business queries fail or are skipped', async () => {
  for (const results of [[], [{ tool: 'now-time-info', error: { code: 'TIMEOUT' } }]]) {
    let closed = false;
    const client = { async snapshot() { return { source: 'live', results, skipped: [] }; }, async close() { closed = true; } };
    const res = await handleMcpRequest(apiRequest({ action: 'snapshot' }, { 'oai-authenticated-user-id': 'test-user' }), TRUSTED_OWNER_ENV, () => client);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.liveBusinessCallSucceeded, false);
    assert.equal(body.error.code, 'NO_SUCCESSFUL_QUERY');
    assert.equal(closed, true);
  }
});

test('snapshot retains partial errors while reporting an actual successful business query', async () => {
  const results = [{ source: 'live', tool: 'now-time-info', result: { content: [{ type: 'text', text: '2026-10-20' }] } }, { tool: 'query-my-coupons', error: { code: 'TIMEOUT' } }];
  const client = { async snapshot() { return { source: 'live', results }; }, async close() {} };
  const res = await handleMcpRequest(apiRequest({ action: 'snapshot' }, { 'oai-authenticated-user-id': 'test-user' }), TRUSTED_OWNER_ENV, () => client);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.liveBusinessCallSucceeded, true);
  assert.equal(body.results[1].error.code, 'TIMEOUT');
});

test('a forged identity header cannot enable hosted access with default settings', async () => {
  let created = false;
  const response = await handleMcpRequest(
    apiRequest({ action: 'discover' }, { 'oai-authenticated-user-id': 'test-user' }),
    { MCD_MCP_TOKEN: TEST_TOKEN },
    () => { created = true; throw new Error('Must not create an account client.'); },
  );
  assert.equal(response.status, 401);
  assert.equal(created, false);
});

test('trusted hosting requires an explicit matching account owner', async () => {
  for (const [user, env] of [
    ['another-visitor', TRUSTED_OWNER_ENV],
    ['test-user', { MCD_TRUST_SITES_IDENTITY: '1' }],
    ['test-user', { MCD_OWNER_USER_ID: 'test-user' }],
    ['test-user', { MCD_TRUST_SITES_IDENTITY: '1', MCD_OWNER_USER_ID: '   ' }],
  ]) {
    const response = await handleMcpRequest(apiRequest({ action: 'discover' }, { 'oai-authenticated-user-id': user }), env, () => { throw new Error('Unauthorized client creation.'); });
    assert.equal(response.status, 401);
  }
});


test('empty tool payloads cannot establish business-call evidence', async () => {
  for (const result of [{ content: [] }, { structuredContent: {} }, { content: [{ type: 'text', text: '  ' }] }, { structuredContent: {}, content: [{ type: 'text', text: '{}' }] }, { content: [{ type: 'text', text: '[]' }] }, { content: [{ type: 'text', text: 'null' }] }]) {
    const { client } = fakeServer({ handle: body => body.method === 'tools/call' ? jsonResponse(body.id, result) : undefined });
    await assert.rejects(() => client.callTool('now-time-info'), { code: 'INVALID_TOOL_RESULT' });
    assert.equal(integrationEvidence(client, 'failed').liveBusinessCallSucceeded, false);
  }
});

test('explicit HTTP-style business failure codes do not leak details or establish success', async () => {
  for (const code of [400, 401, 403, 429, 500, 503]) {
    const result = { structuredContent: { code, message: TEST_TOKEN, data: null } };
    const { client } = fakeServer({ handle: body => body.method === 'tools/call' ? jsonResponse(body.id, result) : undefined });
    await assert.rejects(() => client.callTool('now-time-info'), error => error.code === 'TOOL_ERROR' && !error.message.includes(TEST_TOKEN));
    assert.equal(integrationEvidence(client, 'failed').liveBusinessCallSucceeded, false);
  }
});

test('expired business session rediscovers changed schema before retrying arguments', async () => {
  let generations = 0;
  const { client, requests } = fakeServer({ handle: body => {
    if (body.method === 'initialize') generations++;
    if (body.method === 'tools/list') return jsonResponse(body.id, { tools: [{ name: 'calculate-price', inputSchema: { type: 'object', required: [generations === 1 ? 'oldField' : 'newField'] } }] });
    if (body.method === 'tools/call') return new Response(null, { status: 404 });
  } });
  await assert.rejects(() => client.callTool('calculate-price', { oldField: 'fixture' }), { code: 'SCHEMA_MISMATCH' });
  assert.equal(requests.filter(r => JSON.parse(r.body).method === 'tools/list').length, 2);
  assert.equal(requests.filter(r => JSON.parse(r.body).method === 'tools/call').length, 1);
  assert.equal(integrationEvidence(client, 'failed').liveBusinessCallSucceeded, false);
});

test('repeated business session expiry stops after one fresh validation and retry', async () => {
  const { client, requests } = fakeServer({ handle: body => body.method === 'tools/call' ? new Response(null, { status: 404 }) : undefined });
  await assert.rejects(() => client.callTool('now-time-info'), { code: 'SESSION_EXPIRED' });
  assert.equal(requests.filter(r => JSON.parse(r.body).method === 'initialize').length, 2);
  assert.equal(requests.filter(r => JSON.parse(r.body).method === 'tools/list').length, 2);
  assert.equal(requests.filter(r => JSON.parse(r.body).method === 'tools/call').length, 2);
  assert.equal(integrationEvidence(client, 'failed').liveBusinessCallSucceeded, false);
});


test('contradictory success flags and numeric-string failure codes fail closed', async () => {
  for (const payload of [{ success: true, code: 403, message: TEST_TOKEN }, { code: '403', message: TEST_TOKEN }, { success: true, code: '503', message: TEST_TOKEN }]) {
    for (const result of [{ structuredContent: payload }, { content: [{ type: 'text', text: JSON.stringify(payload) }] }]) {
      const { client } = fakeServer({ handle: body => body.method === 'tools/call' ? jsonResponse(body.id, result) : undefined });
      await assert.rejects(() => client.callTool('now-time-info'), error => error.code === 'TOOL_ERROR' && !error.message.includes(TEST_TOKEN));
      assert.equal(integrationEvidence(client, 'failed').liveBusinessCallSucceeded, false);
    }
  }
});
