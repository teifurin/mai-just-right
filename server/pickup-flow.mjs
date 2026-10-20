import { McpError } from './mcp-client.mjs';
import { moneyToCents } from './quote-comparison.mjs';
import { assertPlainArguments } from './schema.mjs';

export const PICKUP_LIMITS = Object.freeze({ products: 8, offers: 16, candidates: 5, food: 12, states: 150000 });
const fail = (code, message, status = 422) => { throw new McpError(code, message, status); };
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const pathOK = p => Array.isArray(p) && p.length <= 12 && p.every(k => (typeof k === 'string' || Number.isSafeInteger(k)) && !['__proto__', 'prototype', 'constructor'].includes(k));
function at(value, path) {
  if (!pathOK(path)) fail('PROFILE_INVALID', '映射路径无效。', 503);
  for (const key of path) value = value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
  return value;
}
function data(envelope) {
  const result = envelope?.result;
  if (result?.structuredContent !== undefined) return result.structuredContent;
  try { return JSON.parse(result.content.filter(x => x.type === 'text').map(x => x.text).join('\n')); }
  catch { fail('LIVE_SCHEMA_CHANGED', '真实结果不是已核对的结构化数据，请重新核对映射。'); }
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('LIVE_SCHEMA_CHANGED', `${label}字段缺失或变化。`);
  return value;
}
function render(value, context) {
  if (Array.isArray(value)) return value.map(v => render(v, context));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1) {
      if (Object.hasOwn(value, '$row')) { const v = at(context.row, value.$row); if (v === undefined) fail('LIVE_SCHEMA_CHANGED', '真实商品的核价字段缺失。'); return v; }
      if (Object.hasOwn(value, '$context')) { const v = context[value.$context]; if (v === undefined) fail('PROFILE_INVALID', '映射上下文字段缺失。', 503); return v; }
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, context)]));
  }
  return value;
}
function setAt(target, path, value) {
  if (!pathOK(path) || !path.length) fail('PROFILE_INVALID', '写入映射路径无效。', 503);
  let row = target;
  for (const key of path.slice(0, -1)) { if (!row[key] || typeof row[key] !== 'object') row[key] = {}; row = row[key]; }
  row[path.at(-1)] = value;
}

/** This is an explicitly reviewed, server-only mapping, never inferred from names or list prices. */
export function loadPickupProfile(env) {
  if (!env.MCD_PICKUP_PROFILE_JSON) fail('PROFILE_REQUIRED', '真实到店自取流程尚未配置已核对的运行时 Schema 与菜单映射；演示数据不会替代。', 503);
  let profile;
  try { profile = JSON.parse(env.MCD_PICKUP_PROFILE_JSON); assertPlainArguments(profile); }
  catch { fail('PROFILE_INVALID', '服务端真实流程映射格式无效。', 503); }
  if (profile.version !== 1 || profile.reviewed !== true || !profile.schemas || !profile.stores || !profile.menu || !profile.coupons || !profile.quote || !Array.isArray(profile.products) || !Array.isArray(profile.offers)) fail('PROFILE_INVALID', '真实流程映射不完整或尚未核对。', 503);
  if (!['string', 'number'].includes(typeof profile.pickupValue) || (profile.details !== undefined && (!Array.isArray(profile.details) || profile.details.length > 16))) fail('PROFILE_INVALID', '到店自取渠道值或详情查询范围无效。', 503);
  if (profile.products.length < 1 || profile.products.length > 8 || profile.offers.length > 16) fail('PROFILE_INVALID', '真实流程仅支持最多8种需求餐品、16种组合。', 503);
  if (!['fen', 'yuan'].includes(profile.quote.unit)) fail('PROFILE_INVALID', '真实应付金额单位必须经过明确核对。', 503);
  return profile;
}
async function guard(client, profile) {
  const tools = await client.listTools();
  for (const name of ['query-nearby-stores', 'query-meals', 'query-store-coupons', 'calculate-price', ...(profile.details?.length ? ['query-meal-detail'] : [])]) {
    const actual = tools.find(t => t.name === name);
    if (!actual || !profile.schemas[name] || stable(actual.inputSchema) !== stable(profile.schemas[name])) fail('LIVE_SCHEMA_CHANGED', '官方实时工具 Schema 已变化或未核对，已停止真实推荐。');
  }
}
async function mappedCall(client, profile, name, args) {
  await guard(client, profile);
  const result = await client.callTool(name, args);
  // A session recovery can rediscover tools during callTool; never interpret
  // its result using a mapping whose schema changed across that recovery.
  await guard(client, profile);
  return result;
}
function scopedArguments(spec, context) {
  const args = render(spec.arguments, context);
  assertPlainArguments(args);
  if (!pathOK(spec.storePath) || !spec.storePath.length || at(args, spec.storePath) !== context.storeId || !pathOK(spec.channelPath) || !spec.channelPath.length || at(args, spec.channelPath) !== context.channel) fail('PROFILE_INVALID', '每次真实查询与核价必须明确绑定同一门店和到店自取渠道。', 503);
  return args;
}
export async function pickupStores(client, profile, search) {
  if (typeof search !== 'string' || !search.trim() || search.length > 100) fail('INVALID_SEARCH', '请输入1–100字的门店搜索词。', 400);
  await guard(client, profile);
  const args = render(profile.stores.arguments, { search: search.trim(), channel: profile.pickupValue });
  if (!pathOK(profile.stores.channelPath) || !profile.stores.channelPath.length || at(args, profile.stores.channelPath) !== profile.pickupValue) fail('PROFILE_INVALID', '门店搜索必须绑定已核对的到店自取渠道。', 503);
  const result = data(await mappedCall(client, profile, 'query-nearby-stores', args));
  const rows = at(result, profile.stores.rowsPath);
  if (!Array.isArray(rows)) fail('LIVE_SCHEMA_CHANGED', '真实门店列表结构变化。');
  const stores = rows.slice(0, 50).map(row => ({ id: text(at(row, profile.stores.idPath), '门店编码'), name: text(at(row, profile.stores.namePath), '门店名称') }));
  if (new Set(stores.map(s => s.id)).size !== stores.length) fail('LIVE_SCHEMA_CHANGED', '真实门店编码重复，无法安全选择。');
  return { source: 'live', stores, scope: '本次官方门店搜索最多展示50项；请确认门店后选择到店自取。' };
}
async function catalog(client, profile, storeId) {
  text(storeId, '门店编码');
  await guard(client, profile);
  const context = { storeId, channel: profile.pickupValue };
  const sources = {};
  // Mandatory reads are sequential and fail closed: no partial-result recommendation.
  for (const [key, name, spec] of [['menu', 'query-meals', profile.menu], ['coupons', 'query-store-coupons', profile.coupons], ...(profile.details ?? []).map((spec, i) => [`detail${i}`, 'query-meal-detail', spec])]) {
    sources[key] = data(await mappedCall(client, profile, name, scopedArguments(spec, context)));
  }
  const option = (spec, single) => {
    const row = at(sources[spec.source], spec.rowPath);
    if (!row || typeof row !== 'object' || typeof spec.expectedCode !== 'string' || at(row, spec.codePath) !== spec.expectedCode) fail('LIVE_SCHEMA_CHANGED', '已筛选商品或套餐编码发生变化，请重新核对目录映射。');
    if (!single && (!Array.isArray(spec.assertions) || !spec.assertions.length)) fail('PROFILE_INVALID', '套餐必须包含已核对的组成、规格及数量字段断言。', 503);
    for (const check of spec.assertions ?? []) {
      if (!check || !pathOK(check.path) || !check.path.length || check.expected === undefined || stable(at(sources[check.source], check.path)) !== stable(check.expected)) fail('LIVE_SCHEMA_CHANGED', '已核对的套餐组成或规格变化，已停止真实推荐。');
    }
    const id = text(spec.id, '映射标识'), name = text(at(row, spec.namePath), '商品名称');
    const quoteItem = render(spec.quoteItem, { ...context, row });
    assertPlainArguments(quoteItem);
    if (!pathOK(spec.quoteCodePath) || !spec.quoteCodePath.length || at(quoteItem, spec.quoteCodePath) !== spec.expectedCode) fail('PROFILE_INVALID', '核价商品编码与本次已核对目录不一致。', 503);
    for (const binding of spec.quoteBindings ?? []) {
      if (!binding || !pathOK(binding.quotePath) || !binding.quotePath.length || !pathOK(binding.sourcePath) || !binding.sourcePath.length || at(sources[binding.source], binding.sourcePath) === undefined || stable(at(quoteItem, binding.quotePath)) !== stable(at(sources[binding.source], binding.sourcePath))) fail('PROFILE_INVALID', '核价规格与本次已核对详情不一致。', 503);
    }
    const coverage = single ? [{ productId: id, quantity: 1 }] : spec.coverage;
    return { id, name, title: name, coverage, quoteItem, quantityPath: spec.quantityPath, quoteChecks: [{ path: spec.quoteCodePath, expected: spec.expectedCode }, ...(spec.quoteBindings ?? []).map(b => ({ path: b.quotePath, expected: at(sources[b.source], b.sourcePath) }))] };
  };
  const products = profile.products.map(s => option(s, true)), offers = profile.offers.map(s => option(s, false));
  const ids = new Set(products.map(p => p.id));
  if (ids.size !== products.length || new Set(offers.map(o => o.id)).size !== offers.length) fail('PROFILE_INVALID', '映射餐品或组合标识重复。', 503);
  for (const item of [...products, ...offers]) {
    if (!pathOK(item.quantityPath) || !item.quantityPath.length || !Array.isArray(item.coverage) || !item.coverage.length || item.coverage.some(x => !ids.has(x.productId) || !Number.isInteger(x.quantity) || x.quantity < 1 || x.quantity > 12) || new Set(item.coverage.map(x => x.productId)).size !== item.coverage.length) fail('PROFILE_INVALID', '组合覆盖数量或核价数量路径无效。', 503);
  }
  const couponRows = at(sources.coupons, profile.coupons.rowsPath);
  if (!Array.isArray(couponRows)) fail('LIVE_SCHEMA_CHANGED', '适用优惠查询的列表结构变化。');
  const coupons = couponRows.slice(0, 50).map(row => ({ title: text(at(row, profile.coupons.namePath), '优惠名称') }));
  return { context, products, offers, coupons, store: { id: storeId, name: profile.menu.storeNamePath ? text(at(sources.menu, profile.menu.storeNamePath), '门店名称') : storeId } };
}
const scope = '已核对映射选定的最多8种餐品、16种单次组合；最多5个候选逐一官方核价，不代表整店或全局最低价。优惠仅展示，未自动叠加或领券。';
function publicCatalog(c) {
  return { source: 'live', store: c.store, channel: 'pickup', products: c.products.map(({ id, name }) => ({ id, name })), offers: c.offers.map(({ id, title, coverage }) => ({ id, title, coverage })), coupons: c.coupons, limits: PICKUP_LIMITS, scope, warnings: ['组合覆盖与核价字段由操作者按真实详情核对；未映射的规格、套餐、优惠和门店餐品不参与。', '当前流程不自动应用账户券；优惠展示不等于已获得折扣。'] };
}
export async function pickupCatalog(client, profile, storeId) { return publicCatalog(await catalog(client, profile, storeId)); }

export async function pickupRecommend(client, profile, input) {
  if (!input || !Array.isArray(input.demand) || input.demand.length < 1 || input.demand.length > 8 || input.demand.some(x => !x || typeof x.productId !== 'string' || !Number.isInteger(x.quantity) || x.quantity < 1 || x.quantity > 12) || new Set(input.demand.map(x => x.productId)).size !== input.demand.length || input.demand.reduce((s, x) => s + x.quantity, 0) > 12 || !Number.isSafeInteger(input.budgetCents) || input.budgetCents < 0 || input.budgetCents > 1000000 || typeof input.allowExtras !== 'boolean') fail('INVALID_DEMAND', '需求须为最多8种、合计12份餐品；预算使用非负整数分，并明确是否允许额外餐品。', 400);
  const c = await catalog(client, profile, input.storeId), products = new Map(c.products.map(p => [p.id, p]));
  if (input.demand.some(x => !products.has(x.productId))) fail('OUT_OF_SCOPE', '需求含当前已核对目录之外的餐品。', 400);
  if (input.offerIds !== undefined && (!Array.isArray(input.offerIds) || input.offerIds.some(id => !c.offers.some(o => o.id === id)) || new Set(input.offerIds).size !== input.offerIds.length)) fail('INVALID_OFFERS', '请选择当前范围内的组合。', 400);
  const offers = c.offers.filter(o => input.offerIds === undefined || input.offerIds.includes(o.id));
  const wanted = new Map(input.demand.map(x => [x.productId, x.quantity])), carts = [];
  let states = 0;
  function visit(index, selected, coverage) {
    if (++states > PICKUP_LIMITS.states) fail('SCOPE_TOO_BROAD', '搜索状态过多，请缩小组合选择。', 400);
    if (index < offers.length) {
      visit(index + 1, selected, coverage);
      const offer = offers[index], next = new Map(coverage);
      for (const item of offer.coverage) next.set(item.productId, (next.get(item.productId) ?? 0) + item.quantity);
      if ([...next.values()].reduce((s, n) => s + n, 0) <= 12 && (input.allowExtras || [...next].every(([id, n]) => n <= (wanted.get(id) ?? 0)))) visit(index + 1, [...selected, offer], next);
      return;
    }
    if (!selected.length) return;
    const singles = input.demand.map(x => ({ option: products.get(x.productId), quantity: Math.max(0, x.quantity - (coverage.get(x.productId) ?? 0)) })).filter(x => x.quantity);
    const total = new Map(coverage);
    for (const x of singles) total.set(x.option.id, (total.get(x.option.id) ?? 0) + x.quantity);
    if ([...total.values()].reduce((s, n) => s + n, 0) > 12) return;
    carts.push({ title: selected.map(x => x.name).join(' + ').slice(0, 200), options: [...selected.map(option => ({ option, quantity: 1 })), ...singles], coverage: total });
    if (carts.length > 5) fail('SCOPE_TOO_BROAD', '当前组合产生超过5个候选，无法全部官方核价；请减少所选组合，不按列表价猜选最优。', 400);
  }
  visit(0, [], new Map());
  const baseline = { title: '相同需求单点基准', options: input.demand.map(x => ({ option: products.get(x.productId), quantity: x.quantity })), coverage: wanted };
  const quotes = [];
  for (const cart of [baseline, ...carts]) {
    const args = scopedArguments(profile.quote, c.context);
    const items = cart.options.map(({ option, quantity }) => { const item = structuredClone(option.quoteItem); setAt(item, option.quantityPath, quantity); if (at(item, option.quantityPath) !== quantity || option.quoteChecks.some(check => stable(at(item, check.path)) !== stable(check.expected))) fail('PROFILE_INVALID', '核价数量映射覆盖了已核对的商品编码或规格。', 503); return item; });
    setAt(args, profile.quote.itemsPath, items);
    // Recheck bindings after constructing items: a malformed mapping must not replace scope fields.
    if (at(args, profile.quote.storePath) !== c.context.storeId || at(args, profile.quote.channelPath) !== c.context.channel) fail('PROFILE_INVALID', '核价餐品映射覆盖了门店或渠道。', 503);
    const result = await mappedCall(client, profile, 'calculate-price', args);
    const totalCents = moneyToCents(at(data(result), profile.quote.totalPath), profile.quote.unit);
    const food = [...cart.coverage].map(([productId, quantity]) => ({ productId, name: products.get(productId).name, quantity }));
    const extraItems = food.map(x => ({ ...x, quantity: x.quantity - (wanted.get(x.productId) ?? 0) })).filter(x => x.quantity > 0);
    quotes.push({ title: cart.title, totalCents, items: food, extraItems, extraCount: extraItems.reduce((s, x) => s + x.quantity, 0), source: 'live', fetchedAt: result.fetchedAt });
  }
  const [base, ...candidates] = quotes;
  const ranked = quotes.map(q => ({ ...q, savingCents: base.totalCents - q.totalCents })).sort((a, b) => a.totalCents - b.totalCents || a.extraCount - b.extraCount);
  const best = ranked[0];
  return { ...publicCatalog(c), demand: input.demand, baseline: base, candidates, best, budgetCents: input.budgetCents, withinBudget: best.totalCents <= input.budgetCents, verifiedAt: new Date().toISOString(), stats: { visitedStates: states, quotedCarts: quotes.length }, warnings: [...publicCatalog(c).warnings, ...(best.totalCents > input.budgetCents ? ['本次明确范围内没有预算内方案。'] : []), '核价不锁定库存或价格，不创建订单；最终以官方结算为准。'] };
}
