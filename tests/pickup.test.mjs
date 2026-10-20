import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPickupProfile, pickupStores, pickupCatalog, pickupRecommend } from '../server/pickup-flow.mjs';
import { McpError } from '../server/mcp-client.mjs';
import { handleMcpRequest } from '../server/http-handler.mjs';

// Entirely synthetic protocol fixtures, not reusable private requests or official schemas.
const schema = { type: 'object' };
const scoped = { arguments: { store: { $context: 'storeId' }, channel: { $context: 'channel' } }, storePath: ['store'], channelPath: ['channel'] };
function profile() {
  const option = (id, row, code) => ({ id, source: 'menu', rowPath: ['rows', row], namePath: ['name'], codePath: ['code'], expectedCode: code, quoteItem: { code: { $row: ['code'] }, qty: 1 }, quoteCodePath: ['code'], quantityPath: ['qty'] });
  return { version: 1, reviewed: true, pickupValue: 'fixture-pickup', schemas: Object.fromEntries(['query-nearby-stores', 'query-meals', 'query-store-coupons', 'calculate-price'].map(n => [n, schema])), stores: { arguments: { search: { $context: 'search' }, channel: { $context: 'channel' } }, channelPath: ['channel'], rowsPath: ['rows'], idPath: ['id'], namePath: ['name'] }, menu: { ...structuredClone(scoped), storeNamePath: ['storeName'] }, coupons: { ...structuredClone(scoped), rowsPath: ['rows'], namePath: ['name'] }, products: [option('burger', 0, 'fixture-burger'), option('drink', 1, 'fixture-drink')], offers: [{ ...option('pair', 2, 'fixture-pair'), assertions: [{ source: 'menu', path: ['rows', 2, 'contents'], expected: ['fixture-burger', 'fixture-drink'] }], coverage: [{ productId: 'burger', quantity: 1 }, { productId: 'drink', quantity: 1 }] }], quote: { ...structuredClone(scoped), itemsPath: ['items'], totalPath: ['due'], unit: 'fen' } };
}
function client({ failTool, changeSchema, menuOverride, priceMissing, price = 2300 } = {}) {
  const calls = [];
  return { calls, async listTools() { return Object.entries(profile().schemas).map(([name, inputSchema]) => ({ name, inputSchema: changeSchema && name === changeSchema ? { type: 'object', required: ['newField'] } : inputSchema })); }, async callTool(name, args) {
    calls.push({ name, args });
    if (name === failTool) throw new McpError('TIMEOUT', 'Official query timed out.', 504);
    let value;
    if (name === 'query-nearby-stores') value = { rows: [{ id: 'fixture-store', name: '测试门店' }] };
    if (name === 'query-meals') value = menuOverride ?? { storeName: '测试门店', rows: [{ code: 'fixture-burger', name: '测试汉堡' }, { code: 'fixture-drink', name: '测试饮料' }, { code: 'fixture-pair', name: '测试二件套', contents: ['fixture-burger', 'fixture-drink'] }] };
    if (name === 'query-store-coupons') value = { rows: [{ name: '仅展示的测试券' }] };
    if (name === 'calculate-price') value = priceMissing ? {} : { due: args.items.some(i => i.code === 'fixture-pair') ? price : args.items.reduce((s, i) => s + (i.code === 'fixture-burger' ? 2000 : 1000) * i.qty, 0) };
    return { source: 'live', fetchedAt: '2026-10-20T00:00:00Z', result: { structuredContent: value } };
  }, async close() {} };
}
const request = () => ({ storeId: 'fixture-store', demand: [{ productId: 'burger', quantity: 1 }, { productId: 'drink', quantity: 1 }], budgetCents: 2500, allowExtras: false });

test('unconfigured or unreviewed profile cannot start a real recommendation', () => {
  assert.throws(() => loadPickupProfile({}), { code: 'PROFILE_REQUIRED' });
  assert.throws(() => loadPickupProfile({ MCD_PICKUP_PROFILE_JSON: JSON.stringify({ ...profile(), reviewed: false }) }), { code: 'PROFILE_INVALID' });
  assert.equal(loadPickupProfile({ MCD_PICKUP_PROFILE_JSON: JSON.stringify(profile()) }).version, 1);
});
test('runtime schemas gate every mapped real workflow before business calls', async () => {
  const c = client({ changeSchema: 'query-meals' });
  await assert.rejects(() => pickupCatalog(c, profile(), 'fixture-store'), { code: 'LIVE_SCHEMA_CHANGED' });
  assert.equal(c.calls.length, 0);
});
test('store lookup maps only genuine returned fields and does not expose profile', async () => {
  const c = client(), r = await pickupStores(c, profile(), '测试');
  assert.deepEqual(r.stores, [{ id: 'fixture-store', name: '测试门店' }]);
  assert.equal(JSON.stringify(r).includes('quoteItem'), false);
  assert.equal(c.calls[0].args.channel, 'fixture-pickup');
});
test('catalog reads menu and applicable coupons with same store and pickup channel', async () => {
  const c = client(), r = await pickupCatalog(c, profile(), 'fixture-store');
  assert.equal(r.products.length, 2); assert.equal(r.coupons[0].title, '仅展示的测试券');
  assert.equal(JSON.stringify(r).includes('expectedCode'), false);
  for (const call of c.calls) assert.deepEqual(call.args, { store: 'fixture-store', channel: 'fixture-pickup' });
});
test('all bounded carts use official quotes, no menu display price ranking', async () => {
  const c = client(), r = await pickupRecommend(c, profile(), request());
  assert.equal(r.baseline.totalCents, 3000); assert.equal(r.best.totalCents, 2300); assert.equal(r.best.savingCents, 700); assert.equal(r.withinBudget, true);
  assert.equal(r.stats.quotedCarts, 2); assert.equal(r.best.extraCount, 0);
  for (const call of c.calls) { assert.equal(call.args.store, 'fixture-store'); assert.equal(call.args.channel, 'fixture-pickup'); }
  const flipped = await pickupRecommend(client({ price: 4000 }), profile(), request());
  assert.equal(flipped.best.title, '相同需求单点基准'); assert.equal(flipped.withinBudget, false);
});
test('extras are derived from coverage, forbidden unless explicitly allowed', async () => {
  const req = { ...request(), demand: [{ productId: 'burger', quantity: 1 }] };
  const strict = await pickupRecommend(client(), profile(), req);
  assert.equal(strict.stats.quotedCarts, 1);
  const extras = await pickupRecommend(client({ price: 1900 }), profile(), { ...req, allowExtras: true });
  assert.equal(extras.best.extraCount, 1); assert.equal(extras.best.extraItems[0].productId, 'drink');
});
test('no in-budget solution is explicit, while retaining verified least-cost scoped quote', async () => {
  const r = await pickupRecommend(client(), profile(), { ...request(), budgetCents: 100 });
  assert.equal(r.withinBudget, false); assert.ok(r.warnings.some(w => w.includes('没有预算内方案')));
});
test('partial mandatory failure and missing price never return a demo recommendation', async () => {
  for (const name of ['query-meals', 'query-store-coupons', 'calculate-price']) await assert.rejects(() => pickupRecommend(client({ failTool: name }), profile(), request()), { code: 'TIMEOUT' });
  await assert.rejects(() => pickupRecommend(client({ priceMissing: true }), profile(), request()), { code: 'INVALID_PRICE' });
});
test('shifted menu rows or missing product codes fail closed, not silent remapping', async () => {
  await assert.rejects(() => pickupCatalog(client({ menuOverride: { rows: [{ code: 'new-code', name: 'Other' }] } }), profile(), 'fixture-store'), { code: 'LIVE_SCHEMA_CHANGED' });
});
test('mixed-store mapping and quote items overlapping scope are rejected', async () => {
  const p = profile(); p.menu.arguments.store = 'different-store';
  await assert.rejects(() => pickupCatalog(client(), p, 'fixture-store'), { code: 'PROFILE_INVALID' });
  const q = profile(); q.quote.itemsPath = ['store'];
  await assert.rejects(() => pickupRecommend(client(), q, request()), { code: 'PROFILE_INVALID' });
});
test('quantity, budget, selected offers and unknown products respect hard limits', async () => {
  for (const override of [{ demand: [{ productId: 'burger', quantity: 13 }] }, { budgetCents: NaN }, { demand: [{ productId: 'unknown', quantity: 1 }] }, { offerIds: ['unknown'] }, { allowExtras: 'true' }]) await assert.rejects(() => pickupRecommend(client(), profile(), { ...request(), ...override }));
});
test('too many unpriced candidates require narrower explicit selection before pricing', async () => {
  const p = profile(); p.offers = Array.from({ length: 6 }, (_, i) => ({ ...p.offers[0], id: `o${i}` }));
  const c = client(); await assert.rejects(() => pickupRecommend(c, p, request()), { code: 'SCOPE_TOO_BROAD' });
  assert.equal(c.calls.some(x => x.name === 'calculate-price'), false);
  const r = await pickupRecommend(client(), p, { ...request(), offerIds: ['o0'] });
  assert.equal(r.candidates.length, 1);
});
test('new pickup HTTP actions preserve owner access and require server-only mapping', async () => {
  const req = () => new Request('http://localhost:5173/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pickup-recommend', ...request() }) });
  assert.equal((await handleMcpRequest(req(), {}, () => client())).status, 401);
  const r = await handleMcpRequest(req(), { MCD_ALLOW_LOCAL: '1' }, () => client());
  assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'PROFILE_REQUIRED');
  const good = await handleMcpRequest(req(), { MCD_ALLOW_LOCAL: '1', MCD_PICKUP_PROFILE_JSON: JSON.stringify(profile()) }, () => client());
  assert.equal(good.status, 200); assert.equal((await good.json()).best.totalCents, 2300);
});

test('unchanged bundle code with changed composition cannot retain old coverage', async () => {
  const menuOverride = { storeName: 'test', rows: [{ code: 'fixture-burger', name: 'Burger' }, { code: 'fixture-drink', name: 'Drink' }, { code: 'fixture-pair', name: 'Pair', contents: ['fixture-burger', 'different-drink'] }] };
  await assert.rejects(() => pickupRecommend(client({ menuOverride }), profile(), request()), { code: 'LIVE_SCHEMA_CHANGED' });
  const p = profile(); delete p.offers[0].assertions;
  await assert.rejects(() => pickupRecommend(client(), p, request()), { code: 'PROFILE_INVALID' });
});
test('schema changes discovered during a call invalidate the mapping before result use', async () => {
  const c = client(); let changed = false; const original = c.callTool; const list = c.listTools;
  c.callTool = async (...args) => { const r = await original(...args); changed = true; return r; };
  c.listTools = async () => { const tools = await list(); if (changed) tools[1].inputSchema = { type: 'object', required: ['changed'] }; return tools; };
  await assert.rejects(() => pickupCatalog(c, profile(), 'fixture-store'), { code: 'LIVE_SCHEMA_CHANGED' });
  assert.equal(c.calls.length, 1);
});

test('quote product identity cannot differ from the observed menu code', async () => {
  const p = profile(); p.offers[0].quoteItem.code = 'not-the-observed-code';
  await assert.rejects(() => pickupRecommend(client(), p, request()), { code: 'PROFILE_INVALID' });
});

test('quantity injection cannot overwrite verified quote identity or composition', async () => {
  const p = profile(); p.products[0].quantityPath = ['code']; const c = client();
  await assert.rejects(() => pickupRecommend(c, p, request()), { code: 'PROFILE_INVALID' });
  assert.equal(c.calls.some(x => x.name === 'calculate-price'), false);
});
