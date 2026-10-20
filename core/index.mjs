/**
 * 麦麦刚刚好 — dependency-free, deterministic decision engine.
 *
 * Money is represented exclusively as safe integer CNY cents. A catalogue unit
 * is one serving (a 5-piece nugget box is one unit). No function creates orders,
 * contacts a service, or accepts payment. All bundled fixtures are synthetic.
 *
 * planMeal(input, data?) accepts optional { catalog, offers } as its second
 * argument for testing / a future explicitly validated, authorized data adapter.
 * A future adapter must not silently relabel these calculations as live data.
 */
import { catalog, demoOffers, scenarios, DEMO_NOW, DATA_DISCLAIMER } from './fixtures.mjs';
export { catalog, demoOffers, scenarios, DEMO_NOW, DATA_DISCLAIMER };

export const LIMITS = Object.freeze({ products: 8, units: 12, offers: 16, offerUses: 3, people: 12, searchStates: 150_000 });
const CHANNELS = new Set(['pickup', 'delivery']);
const MONEY_LIMIT = 10_000_000;

export class PlanningError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlanningError';
    this.code = code;
  }
}

function fail(code, message) { throw new PlanningError(code, message); }
function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function integer(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('INVALID_INPUT', `${field}必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return value;
}
function safeText(value, field, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_INPUT', `${field}格式不正确。`);
  return value.trim();
}
function strings(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 24) fail('INVALID_INPUT', `${field}必须是有效列表。`);
  return [...new Set(value.map((v) => safeText(v, field, 80)))];
}
function timestamp(value, field) {
  // An explicit timezone avoids a different result on the browser and server.
  const dateString = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!(value instanceof Date) && !dateString) fail('INVALID_DATE', `${field}必须是带时区的 ISO 时间。`);
  if (dateString) {
    const [year, month, day, hour, minute] = value.match(/^\d+|\d+/g).slice(0, 5).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59) fail('INVALID_DATE', `${field}不是有效的日历时间。`);
  }
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) fail('INVALID_DATE', `${field}不是有效时间。`);
  return ms;
}
function sum(values) { return values.reduce((a, b) => a + b, 0); }
function yuan(cents) { return `¥${(cents / 100).toFixed(2)}`; }

function validateCatalog(input) {
  if (!Array.isArray(input) || !input.length || input.length > LIMITS.products) fail('INVALID_CATALOG', `商品目录必须包含 1 到 ${LIMITS.products} 种商品。`);
  const byId = new Map();
  const products = input.map((item, index) => {
    if (!isRecord(item)) fail('INVALID_CATALOG', '商品数据格式不正确。');
    const id = safeText(item.id, '商品编号', 80);
    if (byId.has(id)) fail('DUPLICATE_PRODUCT', `商品编号重复：${id}。`);
    const product = {
      id, name: safeText(item.name, '商品名称'),
      category: typeof item.category === 'string' ? item.category : '餐品',
      priceCents: integer(item.priceCents, 1, MONEY_LIMIT, '商品价格（分）'),
      emoji: typeof item.emoji === 'string' ? item.emoji : '🍽️',
      tags: strings(item.tags, '商品标签'), index,
    };
    byId.set(id, product);
    return product;
  });
  return { products, byId };
}

function normalizeItems(items, byId, field) {
  if (!Array.isArray(items) || items.length < 1 || items.length > LIMITS.units) fail('INVALID_ITEMS', `${field}需要包含 1 到 ${LIMITS.units} 个有效条目。`);
  const merged = new Map();
  for (const item of items) {
    if (!isRecord(item)) fail('INVALID_ITEMS', `${field}格式不正确。`);
    const id = safeText(item.productId, '商品编号', 80);
    if (!byId.has(id)) fail('UNKNOWN_PRODUCT', `不支持的商品：${id}。`);
    const quantity = integer(item.quantity, 1, LIMITS.units, '商品份数');
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  const total = sum([...merged.values()]);
  if (total > LIMITS.units) fail('CART_LIMIT', `当前精确计算最多支持 ${LIMITS.units} 份餐品；麦乐鸡每盒计 1 份。`);
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

function validateOffers(input, byId) {
  if (!Array.isArray(input) || input.length > LIMITS.offers) fail('INVALID_OFFERS', `最多支持 ${LIMITS.offers} 个优惠。`);
  const ids = new Set();
  return input.map((raw) => {
    if (!isRecord(raw)) fail('INVALID_OFFERS', '优惠数据格式不正确。');
    const id = safeText(raw.id, '优惠编号', 80);
    if (ids.has(id)) fail('DUPLICATE_OFFER', `优惠编号重复：${id}，不能重复计入。`);
    ids.add(id);
    const items = normalizeItems(raw.items, byId, '优惠餐品');
    const channels = raw.channels === undefined ? ['pickup', 'delivery'] : strings(raw.channels, '适用渠道');
    if (!channels.length || channels.some((c) => !CHANNELS.has(c))) fail('INVALID_OFFERS', `优惠 ${id} 的适用渠道不正确。`);
    const startMs = raw.startsAt === undefined ? -Infinity : timestamp(raw.startsAt, '优惠开始时间');
    const endMs = raw.expiresAt === undefined ? Infinity : timestamp(raw.expiresAt, '优惠截止时间');
    if (startMs > endMs) fail('INVALID_DATE', `优惠 ${id} 的开始时间晚于截止时间。`);
    return {
      id, title: safeText(raw.title, '优惠名称'), type: raw.type === 'coupon' ? 'coupon' : 'bundle',
      priceCents: integer(raw.priceCents, 0, MONEY_LIMIT, '优惠价格（分）'), items,
      maxUses: raw.maxUses === undefined ? 1 : integer(raw.maxUses, 1, LIMITS.offerUses, '优惠限用次数'),
      channels, storeIds: strings(raw.storeIds, '适用门店'),
      exclusiveGroup: raw.exclusiveGroup === undefined ? undefined : safeText(raw.exclusiveGroup, '互斥优惠组', 80),
      startsAt: raw.startsAt, expiresAt: raw.expiresAt, startMs, endMs,
      requirements: strings(raw.requirements, '使用条件'),
    };
  });
}

function eligibility(offer, context, byId) {
  if (context.nowMs < offer.startMs) return { code: 'NOT_STARTED', reason: '尚未开始' };
  if (context.nowMs > offer.endMs) return { code: 'EXPIRED', reason: '已过期' };
  if (!offer.channels.includes(context.channel)) return { code: 'CHANNEL', reason: `不适用于${context.channel === 'pickup' ? '自取' : '配送'}` };
  if (offer.storeIds.length && !context.storeId) return { code: 'STORE_REQUIRED', reason: '需要确认指定门店，当前未选择' };
  if (offer.storeIds.length && !offer.storeIds.includes(context.storeId)) return { code: 'STORE', reason: '不适用于当前门店' };
  const excluded = offer.items.find((item) => byId.get(item.productId).tags.some((tag) => context.excludedTags.includes(tag)));
  if (excluded) return { code: 'EXCLUDED_ITEM', reason: `包含你已排除的${byId.get(excluded.productId).name}` };
  return null;
}

function candidateCompare(a, b) {
  return a.totalCents - b.totalCents || a.extraCount - b.extraCount || a.offerCount - b.offerCount || a.key.localeCompare(b.key);
}

/**
 * Exact bounded search. Offers are considered once, with 0..maxUses selected.
 * Remaining requested quantities are always bought at regular unit prices.
 * Therefore every feasible optimum has a representative in this search.
 *
 * Pruning is admissible: positive costs; integer fractional-relaxation lower
 * bound; and dominance at (offer index, purchased quantities, exclusive groups).
 * A hard complexity guard throws instead of returning an unproven optimum.
 */
function search(products, requested, offers) {
  const n = products.length;
  const required = products.map((p) => requested.get(p.id) || 0);
  const requestedTotal = sum(required);
  const price = products.map((p) => p.priceCents);
  const indexById = new Map(products.map((p, i) => [p.id, i]));
  const activeOffers = offers.filter((o) => o.items.some((item) => requested.has(item.productId)))
    .map((offer) => {
      const vector = Array(n).fill(0);
      for (const item of offer.items) vector[indexById.get(item.productId)] = item.quantity;
      return { ...offer, vector };
    })
    // Visit valuable bundles first; results remain deterministic.
    .sort((a, b) => {
      const aSaving = sum(a.vector.map((q, i) => q * price[i])) - a.priceCents;
      const bSaving = sum(b.vector.map((q, i) => q * price[i])) - b.priceCents;
      return bSaving - aSaving || a.id.localeCompare(b.id);
    });
  const groupCounts = new Map();
  for (const o of activeOffers) if (o.exclusiveGroup) groupCounts.set(o.exclusiveGroup, (groupCounts.get(o.exclusiveGroup) || 0) + 1);
  const groupBits = new Map([...groupCounts].filter(([, count]) => count > 1).map(([name], i) => [name, 2 ** i]));
  for (const o of activeOffers) o.groupBit = groupBits.get(o.exclusiveGroup) || 0;
  // For each product use a relaxed per-unit floor. A bundle's summed floor
  // contribution cannot exceed its own price, even if it covers many products.
  const lowerRates = [...price];
  for (const o of activeOffers) {
    const relaxed = Math.floor(o.priceCents / sum(o.vector));
    o.vector.forEach((q, i) => { if (q) lowerRates[i] = Math.min(lowerRates[i], relaxed); });
  }

  let bestExact = null;
  let bestExtra = null;
  const exactCandidates = new Map();
  const extraCandidates = new Map();
  const memo = new Map();
  const stats = { visitedStates: 0, prunedStates: 0, candidateCount: 0, activeOfferCount: activeOffers.length, requestedUnits: requestedTotal, maxCartUnits: LIMITS.units, provenOptimal: true };

  function consider(got, cost, picks) {
    const fulfilled = got.map((q, i) => Math.max(q, required[i]));
    const extraCount = sum(fulfilled) - requestedTotal;
    const regular = required.map((q, i) => Math.max(q - got[i], 0));
    const totalCents = cost + sum(regular.map((q, i) => q * price[i]));
    const selected = picks.filter((x) => x.uses > 0);
    const key = selected.map((x) => `${x.offer.id}:${x.uses}`).sort().join('|') || 'regular';
    const candidate = { key, totalCents, extraCount, quantities: fulfilled, regular, picks: selected, offerCount: sum(selected.map((x) => x.uses)) };
    const group = extraCount ? extraCandidates : exactCandidates;
    if (!group.has(key)) { stats.candidateCount += 1; group.set(key, candidate); }
    // Only bounded, inexpensive comparison candidates are retained. This does
    // not constrain the exact search or the global minimum of either class.
    if (group.size > 8) {
      const keep = [...group.values()].sort(candidateCompare).slice(0, 5);
      group.clear(); keep.forEach((c) => group.set(c.key, c));
    }
    if (extraCount) {
      if (!bestExtra || candidateCompare(candidate, bestExtra) < 0) bestExtra = candidate;
    } else if (!bestExact || candidateCompare(candidate, bestExact) < 0) bestExact = candidate;
  }

  function visit(index, got, cost, usedGroups, picks) {
    stats.visitedStates += 1;
    if (stats.visitedStates > LIMITS.searchStates) fail('COMPLEXITY_LIMIT', '当前优惠组合过于复杂。请减少餐品或优惠数量后重新计算；未返回未经验证的最低价。');
    const key = `${index};${got.join(',')};${usedGroups}`;
    const previous = memo.get(key);
    const offerCount = sum(picks.map((p) => p.uses));
    if (previous && (previous.cost < cost || previous.cost === cost && previous.offerCount <= offerCount)) { stats.prunedStates += 1; return; }
    memo.set(key, { cost, offerCount });
    consider(got, cost, picks);
    if (index === activeOffers.length) return;
    const extra = sum(got.map((q, i) => Math.max(0, q - required[i])));
    const lowerBound = cost + sum(required.map((q, i) => Math.max(0, q - got[i]) * lowerRates[i]));
    const exactBound = bestExact?.totalCents ?? Infinity;
    const extraBound = bestExtra?.totalCents ?? Infinity;
    if (extra ? lowerBound > extraBound : lowerBound > exactBound && lowerBound > extraBound) { stats.prunedStates += 1; return; }
    const offer = activeOffers[index];
    const cap = offer.groupBit && (usedGroups & offer.groupBit) ? 0 : offer.maxUses;
    for (let uses = cap; uses >= 0; uses -= 1) {
      const next = got.map((q, i) => q + offer.vector[i] * uses);
      if (sum(next.map((q, i) => Math.max(q, required[i]))) > LIMITS.units) { stats.prunedStates += 1; continue; }
      const nextGroups = uses ? usedGroups | offer.groupBit : usedGroups;
      if (uses) picks.push({ offer, uses });
      visit(index + 1, next, cost + offer.priceCents * uses, nextGroups, picks);
      if (uses) picks.pop();
    }
  }
  visit(0, Array(n).fill(0), 0, 0, []);
  return { bestExact, bestExtra, exactCandidates: [...exactCandidates.values()].sort(candidateCompare), extraCandidates: [...extraCandidates.values()].sort(candidateCompare), stats };
}

function materialize(candidate, products, requested, baselineCents, budgetCents) {
  const items = products.flatMap((product, i) => {
    const quantity = candidate.quantities[i];
    if (!quantity) return [];
    const requestedQuantity = requested.get(product.id) || 0;
    return [{ productId: product.id, name: product.name, quantity, unitPriceCents: product.priceCents, requestedQuantity, extraQuantity: Math.max(0, quantity - requestedQuantity) }];
  });
  const offers = candidate.picks.map(({ offer, uses }) => ({
    id: offer.id, title: offer.title, type: offer.type, priceCents: offer.priceCents, uses,
    totalCents: offer.priceCents * uses,
    items: offer.items.map((item) => ({ ...item })),
    channels: [...offer.channels], expiresAt: offer.expiresAt,
    requirements: [...offer.requirements], exclusiveGroup: offer.exclusiveGroup,
  }));
  const retailLines = products.flatMap((product, i) => candidate.regular[i] ? [{ label: `${product.name} × ${candidate.regular[i]}（单点）`, amountCents: product.priceCents * candidate.regular[i] }] : []);
  const breakdown = [...offers.map((o) => ({ label: `${o.title}${o.uses > 1 ? ` × ${o.uses}` : ''}`, amountCents: o.totalCents })), ...retailLines];
  const basketRetailCents = sum(items.map((i) => i.quantity * i.unitPriceCents));
  const savingCents = baselineCents - candidate.totalCents;
  const explanation = candidate.extraCount
    ? `覆盖全部原始需求，另多出 ${candidate.extraCount} 份餐品。与原需求单点价相比${savingCents >= 0 ? `少付 ${yuan(savingCents)}` : `多付 ${yuan(-savingCents)}`}；额外餐品未按“必需品”计入节省。`
    : `恰好满足原始需求，${offers.length ? `使用 ${sum(offers.map((o) => o.uses))} 份有效优惠` : '按单点价购买'}，不增加任何餐品。${savingCents > 0 ? `比原需求单点少付 ${yuan(savingCents)}。` : '当前没有更便宜的适用组合。'}`;
  return {
    id: candidate.key, title: candidate.extraCount ? '含额外餐品的组合' : offers.length ? '刚刚好方案' : '按需单点方案',
    totalCents: candidate.totalCents, savingCents, extraCount: candidate.extraCount,
    basketRetailCents, advertisedSavingCents: basketRetailCents - candidate.totalCents,
    items, offers, breakdown, explanation,
    withinBudget: budgetCents === null || candidate.totalCents <= budgetCents,
    budgetGapCents: budgetCents === null ? 0 : Math.max(0, candidate.totalCents - budgetCents),
  };
}

/**
 * @param {object} input
 * @param {Array<{productId:string,quantity:number}>} input.items
 * @param {number|null} [input.budgetCents] undefined/null means no budget cap.
 * @param {number} [input.people=1]
 * @param {boolean} [input.allowExtras=false]
 * @param {'pickup'|'delivery'} [input.channel='pickup']
 * @param {string|Date} [input.now=DEMO_NOW] ISO-8601 including timezone.
 * @param {string} [input.storeId] Unknown store-restricted coupons are excluded.
 * @param {string[]} [input.excludedTags]
 * @param {{catalog?:Array,offers?:Array}} [data] Validated custom test/adapter data.
 */
export function planMeal(input, data = {}) {
  if (!isRecord(input) || !isRecord(data)) fail('INVALID_INPUT', '请提供完整的点餐需求。');
  const { products, byId } = validateCatalog(data.catalog ?? catalog);
  const normalized = normalizeItems(input.items, byId, '原始需求');
  const budgetCents = input.budgetCents === undefined || input.budgetCents === null ? null : integer(input.budgetCents, 0, MONEY_LIMIT, '预算（分）');
  const people = input.people === undefined ? 1 : integer(input.people, 1, LIMITS.people, '人数');
  const allowExtras = input.allowExtras === undefined ? false : input.allowExtras;
  if (typeof allowExtras !== 'boolean') fail('INVALID_INPUT', '是否接受额外餐品必须是明确的是或否。');
  const channel = input.channel ?? 'pickup';
  if (!CHANNELS.has(channel)) fail('INVALID_INPUT', '请选择自取或配送。');
  const nowMs = timestamp(input.now ?? DEMO_NOW, '计算时间');
  const storeId = input.storeId === undefined ? undefined : safeText(input.storeId, '门店编号', 80);
  const excludedTags = strings(input.excludedTags, '排除偏好');
  const requested = new Map(normalized.map((i) => [i.productId, i.quantity]));
  const conflict = normalized.find((i) => byId.get(i.productId).tags.some((tag) => excludedTags.includes(tag)));
  if (conflict) fail('EXCLUDED_REQUEST', `已选的${byId.get(conflict.productId).name}与你的排除偏好冲突，请先确认原始需求。`);
  const validatedOffers = validateOffers(data.offers ?? demoOffers, byId);
  const context = { nowMs, channel, storeId, excludedTags };
  const discardedOffers = [];
  const eligibleOffers = validatedOffers.filter((offer) => {
    const rejection = eligibility(offer, context, byId);
    if (rejection) discardedOffers.push({ id: offer.id, title: offer.title, ...rejection });
    return !rejection;
  });
  const baselineCents = sum(normalized.map((i) => byId.get(i.productId).priceCents * i.quantity));
  const result = search(products, requested, eligibleOffers);
  const convert = (c) => materialize(c, products, requested, baselineCents, budgetCents);
  const exactBest = convert(result.bestExact);
  const extraBest = result.bestExtra ? convert(result.bestExtra) : null;
  const chooseExtra = !!(allowExtras && result.bestExtra && candidateCompare(result.bestExtra, result.bestExact) < 0);
  const best = chooseExtra ? extraBest : exactBest;
  const flexibleBest = result.bestExtra && candidateCompare(result.bestExtra, result.bestExact) < 0 ? extraBest : exactBest;
  const alternativesPool = allowExtras ? [...result.exactCandidates, ...result.extraCandidates] : result.exactCandidates;
  const alternatives = alternativesPool.sort(candidateCompare).filter((c) => c.key !== best.id).slice(0, 2).map(convert);
  const notRecommended = result.extraCandidates.filter((c) => c.key !== best.id).slice(0, 2).map((c) => {
    const plan = convert(c);
    const incrementalCostCents = plan.totalCents - exactBest.totalCents;
    const reason = !allowExtras
      ? `多出 ${plan.extraCount} 份不在原始需求中的餐品。${incrementalCostCents > 0 ? `还比刚好买够多付 ${yuan(incrementalCostCents)}。` : incrementalCostCents === 0 ? '实付相同，没有必要为优惠多拿餐品。' : `虽然少付 ${yuan(-incrementalCostCents)}，但你选择了不多买，所以未采纳。`}`
      : `相比推荐方案${plan.totalCents > best.totalCents ? `多付 ${yuan(plan.totalCents - best.totalCents)}` : '实付没有优势'}，并增加 ${plan.extraCount} 份餐品。`;
    return { ...plan, title: plan.offers.find((o) => o.items.some((i) => (requested.get(i.productId) || 0) < i.quantity * o.uses))?.title || '多买套餐比较', reason, incrementalCostCents };
  });
  const warnings = [];
  if (!best.withinBudget) warnings.push(`当前${allowExtras ? '允许的' : '不多买的'}最便宜组合仍超预算 ${yuan(best.budgetGapCents)}；原始餐品需求没有被擅自删减。`);
  if (channel === 'delivery') warnings.push(`${best.withinBudget && budgetCents !== null ? '餐品金额预算内，配送等费用未核定。' : ''}配送结果只比较餐品金额，尚未计入配送费、打包费或平台服务费，不能视为最终支付总额。`);
  if (excludedTags.length) warnings.push('排除偏好仅按演示商品标签匹配，不替代实际商品配料信息。');
  return {
    source: 'demo', currency: 'CNY', disclaimer: DATA_DISCLAIMER,
    amountScope: 'food-only', finalTotalCents: channel === 'delivery' ? null : best.totalCents,
    requestedItems: normalized.map((item) => ({ ...item, name: byId.get(item.productId).name, unitPriceCents: byId.get(item.productId).priceCents })),
    baselineCents, budgetCents, people, allowExtras, channel, storeId: storeId ?? null, excludedTags,
    best, exactBest, flexibleBest, extraBest, alternatives, notRecommended,
    comparison: {
      exactCents: exactBest.totalCents, flexibleCents: flexibleBest.totalCents,
      extraPlanCents: extraBest?.totalCents ?? null,
      incrementalCostCents: extraBest ? extraBest.totalCents - exactBest.totalCents : null,
      extraCount: extraBest?.extraCount ?? 0,
      budgetFeasible: channel === 'delivery' ? null : best.withinBudget,
      foodBudgetFeasible: best.withinBudget,
    },
    stats: { ...result.stats, offeredCount: validatedOffers.length, eligibleOfferCount: eligibleOffers.length, discardedOfferCount: discardedOffers.length, evaluatedAt: new Date(nowMs).toISOString(), algorithm: 'bounded-exact-search' },
    discardedOffers, warnings, split: splitBill(best.totalCents, people),
  };
}

/**
 * Largest-remainder integer allocation. Equal remainders use participant order.
 * Weights are shares of the final bill, not inferred individual food prices.
 * BigInt multiplication preserves correctness even at Number.MAX_SAFE_INTEGER.
 */
export function splitBill(totalCents, participants) {
  integer(totalCents, 0, Number.MAX_SAFE_INTEGER, '分账总额（分）');
  const rows = typeof participants === 'number'
    ? Array.from({ length: integer(participants, 1, LIMITS.people, '分账人数') }, (_, i) => ({ id: `person-${i + 1}`, name: `第 ${i + 1} 位`, weight: 1 }))
    : participants;
  if (!Array.isArray(rows) || !rows.length || rows.length > LIMITS.people) fail('INVALID_SPLIT', `分账人数需要在 1 到 ${LIMITS.people} 之间。`);
  const ids = new Set();
  const clean = rows.map((row, i) => {
    if (!isRecord(row)) fail('INVALID_SPLIT', '分账成员格式不正确。');
    const id = row.id === undefined ? `person-${i + 1}` : safeText(row.id, '成员编号', 80);
    if (ids.has(id)) fail('INVALID_SPLIT', '分账成员编号不能重复。');
    ids.add(id);
    return { id, name: row.name === undefined ? `第 ${i + 1} 位` : safeText(row.name, '成员名称', 40), weight: row.weight === undefined ? 1 : integer(row.weight, 1, 1000, '分账权重') };
  });
  const denominator = BigInt(sum(clean.map((p) => p.weight)));
  const total = BigInt(totalCents);
  const allocations = clean.map((p, index) => {
    const numerator = total * BigInt(p.weight);
    return { ...p, index, amountCents: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let pennies = totalCents - sum(allocations.map((p) => p.amountCents));
  const ranking = [...allocations].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < pennies; i += 1) ranking[i].amountCents += 1;
  return allocations.map(({ id, name, weight, amountCents }) => ({ id, name, weight, amountCents }));
}

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function numberFromText(value) {
  if (/^\d+(?:\.\d{1,2})?$/.test(value)) return Number(value);
  const [whole, decimal] = value.split('点');
  let answer = 0; let pending = 0;
  for (const char of whole) {
    if (Object.hasOwn(CN_DIGITS, char)) pending = CN_DIGITS[char];
    else if ('十百千'.includes(char)) { answer += (pending || 1) * ({ 十: 10, 百: 100, 千: 1000 }[char]); pending = 0; }
    else return NaN;
  }
  answer += pending;
  if (decimal !== undefined) {
    if (!decimal.length || decimal.length > 2 || [...decimal].some((ch) => !Object.hasOwn(CN_DIGITS, ch))) return NaN;
    answer += Number(`0.${[...decimal].map((ch) => CN_DIGITS[ch]).join('')}`);
  }
  return answer;
}

const NUMBER_TEXT = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千点]+)';
const ALIASES = [
  ['spicy-burger', ['麦辣鸡腿汉堡', '麦辣鸡腿堡', '麦辣鸡堡', '麦辣堡', '辣堡']],
  ['grilled-burger', ['板烧鸡腿汉堡', '板烧鸡腿堡', '板烧鸡堡', '板烧堡', '板烧']],
  ['big-mac', ['巨无霸']],
  ['nuggets', ['麦乐鸡（5块）', '麦乐鸡(5块)', '麦乐鸡', '鸡块']],
  ['fries', ['中薯条', '中薯', '薯条']],
  ['cola', ['中可乐', '可乐']],
  ['americano', ['美式咖啡', '热美式', '美式']],
  ['corn', ['玉米杯', '玉米']],
];

/** Basic Chinese rule parser, deliberately not an LLM or an ordering agent. */
export function parseIntent(text) {
  if (typeof text !== 'string' || text.length > 600) fail('INVALID_INTENT', '请用 600 字以内的一句话描述需求。');
  const source = text.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const output = {};
  const recognized = [];
  const notes = [];
  const explicitBudget = new RegExp(`(?:预算(?:是|为)?|不超过|不超|最多(?:花)?|限额|上限|控制在)\\s*[¥￥]?\\s*([-−]?${NUMBER_TEXT})`).exec(source);
  const currencyBudget = new RegExp(`(?:[¥￥]\\s*([-−]?${NUMBER_TEXT})|([-−]?${NUMBER_TEXT})\\s*(?:元|块钱))`).exec(source);
  const budgetText = explicitBudget?.[1] || currencyBudget?.[1] || currencyBudget?.[2];
  if (budgetText) {
    const value = Math.round(numberFromText(budgetText) * 100);
    if (Number.isSafeInteger(value) && value >= 0 && value <= MONEY_LIMIT) { output.budgetCents = value; recognized.push(`预算 ${yuan(value)}`); }
    else notes.push('预算无法可靠识别，请手动填写。');
  }
  const peopleText = new RegExp(`(${NUMBER_TEXT})\\s*(?:个人|人)`).exec(source)?.[1];
  if (peopleText) {
    const value = numberFromText(peopleText);
    if (Number.isInteger(value) && value >= 1 && value <= LIMITS.people) { output.people = value; recognized.push(`${value} 人`); }
    else notes.push('当前人数范围为 1–12 人，请手动确认。');
  }
  const pickupAt = Math.max(source.lastIndexOf('自取'), source.lastIndexOf('到店'), source.lastIndexOf('堂食'));
  const deliveryAt = Math.max(source.lastIndexOf('外卖'), source.lastIndexOf('配送'), source.lastIndexOf('送到'));
  if (pickupAt >= 0 || deliveryAt >= 0) { output.channel = deliveryAt > pickupAt ? 'delivery' : 'pickup'; recognized.push(output.channel === 'pickup' ? '到店自取' : '配送'); }
  if (/不要凑单|不凑单|不加购|不多买|刚好够|只买这些|不要多的|拒绝凑单|不接受多买/.test(source)) output.allowExtras = false;
  else if (/(?:可以|允许|接受|愿意)(?:少量)?(?:多买|加购|凑单)|便宜就多买/.test(source)) output.allowExtras = true;
  if (output.allowExtras !== undefined) recognized.push(output.allowExtras ? '允许少量额外餐品' : '不为优惠多买');

  const excluded = new Set();
  if (/(?:不吃|不要|不想吃|无|忌)(?:任何)?辣/.test(source)) excluded.add('spicy');
  if (/不喝(?:含糖|有糖|甜)|无糖/.test(source)) excluded.add('sugary');
  if (/无咖啡因|不摄入咖啡因/.test(source)) excluded.add('caffeine');
  if (/不吃牛肉|不要牛肉/.test(source)) excluded.add('beef');
  if (/不吃鸡肉|不要鸡肉/.test(source)) excluded.add('chicken');
  if (/只吃素|吃素|不要肉|不吃肉|素食者|(?:^|[，,\s])素食(?:$|[，,\s])/.test(source)) excluded.add('meat');
  if (/不要饮料|不喝饮料/.test(source)) excluded.add('drink');
  const found = new Map();
  const matches = [];
  for (const [productId, aliases] of ALIASES) {
    const pattern = new RegExp(aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    for (const match of source.matchAll(pattern)) matches.push({ productId, start: match.index, end: match.index + match[0].length });
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  // Generic categories cannot safely choose a specific product or disappear from a partial match.
  const ambiguous = [...source.matchAll(/汉堡|饮料/g)].filter(match =>
    !matches.some(known => match.index >= known.start && match.index + match[0].length <= known.end)
    && !/(?:不要|不喝)$/.test(source.slice(0, match.index)));
  if (ambiguous.length) {
    output.unknownText = [...new Set(ambiguous.map(match => match[0]))];
    notes.push(`未确认餐品：${output.unknownText.join('、')}，请手动选择具体商品，未自动代选。`);
  }
  let invalidQuantity = false;
  for (const match of matches) {
    const before = source.slice(0, match.start);
    const lastSegment = before.split(/[，,。；;\n]/).at(-1);
    const intentMarkers = [...lastSegment.matchAll(/不要|不喝|不吃|不用|去掉|排除|不需要|不想要|想要|需要|要|来|加/g)];
    const lastMarker = intentMarkers.at(-1)?.[0];
    if (lastMarker && /^(?:不|去掉|排除)/.test(lastMarker)) { excluded.add(match.productId); found.delete(match.productId); continue; }
    const prefix = new RegExp(`(${NUMBER_TEXT})\\s*(?:个|份|杯|盒|组)?\\s*(?:的)?$`).exec(lastSegment);
    const after = source.slice(match.end);
    const suffix = new RegExp(`^\\s*(?:[x×*]\\s*(${NUMBER_TEXT})|(${NUMBER_TEXT})\\s*(?:个|份|杯|盒))`).exec(after);
    const countText = prefix?.[1] || suffix?.[1] || suffix?.[2];
    const quantity = countText ? numberFromText(countText) : 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > LIMITS.units) { invalidQuantity = true; continue; }
    excluded.delete(match.productId);
    found.set(match.productId, (found.get(match.productId) || 0) + quantity);
  }
  if (sum([...found.values()]) > LIMITS.units) invalidQuantity = true;
  if (found.size && !invalidQuantity) {
    output.items = [...found].map(([productId, quantity]) => ({ productId, quantity }));
    recognized.push(output.items.map((i) => `${catalog.find((p) => p.id === i.productId).name} × ${i.quantity}`).join('、'));
  }
  if (invalidQuantity) notes.push('餐品份数超出 1–12 份或不够明确，未自动套用餐品，请手动确认。');
  if (found.has('nuggets')) notes.push('麦乐鸡按 5 块一份计算。');
  if (excluded.size) {
    output.excludedTags = [...excluded];
    const labels = { spicy: '辣味', sugary: '含糖饮料', caffeine: '咖啡因', beef: '牛肉', chicken: '鸡肉', meat: '肉类', drink: '饮料' };
    recognized.push(`排除：${[...excluded].map((tag) => labels[tag] || catalog.find((p) => p.id === tag)?.name || tag).join('、')}`);
  }
  output.recognized = recognized;
  output.note = recognized.length
    ? `规则识别：${recognized.join('；')}。${notes.join('')}请确认下方选项后再计算。`
    : `${notes.join('')}暂未识别出明确需求。可以试试“一个人，预算35元，一个麦辣鸡腿堡、一份薯条和一杯可乐，自取，不凑单”。`;
  return output;
}

/** A plain-text, shareable decision record, never an order or payment receipt. */
export function makeReceipt(plan) {
  if (!isRecord(plan) || !isRecord(plan.best) || !Array.isArray(plan.requestedItems) || plan.source !== 'demo') fail('INVALID_RECEIPT', '请先完成一次有效计算。');
  const lines = [
    '麦麦刚刚好 · 点餐决策单（演示）',
    `参考时间：${plan.stats.evaluatedAt}`,
    `方式：${plan.channel === 'delivery' ? '配送（仅餐品金额）' : '到店自取'}｜人数：${plan.people}`,
    '', '我本来想买：',
    ...plan.requestedItems.map((item) => `  ${item.name} × ${item.quantity}`),
    '', `原需求单点合计：${yuan(plan.baselineCents)}`,
    '推荐组合：',
    ...plan.best.breakdown.map((line) => `  ${line.label}  ${yuan(line.amountCents)}`),
    `餐品实付：${yuan(plan.best.totalCents)}`,
    `比原需求单点${plan.best.savingCents >= 0 ? '少付' : '多付'}：${yuan(Math.abs(plan.best.savingCents))}`,
    `额外餐品：${plan.best.extraCount} 份`,
    `预算：${plan.budgetCents === null ? '未设上限' : `${yuan(plan.budgetCents)}（${plan.channel === 'delivery' ? plan.best.withinBudget ? '餐品金额预算内，配送等费用未核定' : `仅餐品金额已超预算 ${yuan(plan.best.budgetGapCents)}，配送等费用另计` : plan.best.withinBudget ? '满足预算' : `还差 ${yuan(plan.best.budgetGapCents)}`}）`}`,
  ];
  if (plan.people > 1) {
    const weighted = new Set(plan.split.map((p) => p.weight)).size > 1;
    lines.push('', weighted ? '按份额分摊参考：' : '均分参考：', ...plan.split.map((p) => `  ${p.name}${weighted ? `（${p.weight} 份）` : ''}：${yuan(p.amountCents)}`));
  }
  if (plan.notRecommended.length) lines.push('', '没有采纳：', `  ${plan.notRecommended[0].reason}`);
  if (plan.warnings.length) lines.push('', ...plan.warnings);
  lines.push('', DATA_DISCLAIMER);
  return lines.join('\n');
}
