import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, demoOffers, scenarios, DEMO_NOW, LIMITS, PlanningError, planMeal, parseIntent, splitBill, makeReceipt } from '../core/index.mjs';

const sampleProducts = [
  { id: 'a', name: 'A', priceCents: 1000, tags: [] },
  { id: 'b', name: 'B', priceCents: 500, tags: [] },
  { id: 'c', name: 'C', priceCents: 700, tags: ['spicy'] },
];
const offer = (id, items, priceCents, rest = {}) => ({ id, title: id, items, priceCents, ...rest });
const item = (productId, quantity = 1) => ({ productId, quantity });
const custom = (offers = [], products = sampleProducts) => ({ catalog: products, offers });
const throwsCode = (fn, code) => assert.throws(fn, (err) => err instanceof PlanningError && err.code === code);

function assertAccounting(result) {
  assert.equal(result.best.breakdown.reduce((a, line) => a + line.amountCents, 0), result.best.totalCents);
  assert.equal(result.best.savingCents, result.baselineCents - result.best.totalCents);
  assert.equal(result.split.reduce((a, p) => a + p.amountCents, 0), result.best.totalCents);
  assert.equal(result.best.extraCount, result.best.items.reduce((a, i) => a + i.extraQuantity, 0));
  assert.ok(result.best.items.reduce((a, i) => a + i.quantity, 0) <= LIMITS.units);
  for (const requested of result.requestedItems) assert.ok(result.best.items.find((i) => i.productId === requested.productId).quantity >= requested.quantity);
}

test('default scenario preserves intent, realizes real savings, and explains the upsell', () => {
  const result = planMeal(scenarios[0]);
  assert.equal(result.source, 'demo');
  assert.equal(result.baselineCents, 4900);
  assert.equal(result.best.totalCents, 3300);
  assert.equal(result.best.savingCents, 1600);
  assert.equal(result.best.extraCount, 0);
  assert.equal(result.notRecommended[0].totalCents, 3900);
  assert.equal(result.notRecommended[0].incrementalCostCents, 600);
  assert.equal(result.notRecommended[0].extraCount, 1);
  assert.equal(result.notRecommended[0].advertisedSavingCents, 2300);
  assert.equal(result.notRecommended[0].savingCents, 1000);
  assert.match(result.notRecommended[0].reason, /多付 ¥6\.00/);
  assert.equal(result.stats.evaluatedAt, new Date(DEMO_NOW).toISOString());
  assert.equal(result.stats.provenOptimal, true);
  assert.match(result.disclaimer, /合成演示/);
  assertAccounting(result);
});

test('all scenario prompts reliably populate the same exact form state', () => {
  for (const scenario of scenarios) {
    const parsed = parseIntent(scenario.prompt);
    assert.deepEqual(parsed.items, scenario.items);
    assert.equal(parsed.people, scenario.people);
    assert.equal(parsed.budgetCents, scenario.budgetCents);
    assert.equal(parsed.allowExtras, scenario.allowExtras);
    assert.equal(parsed.channel, scenario.channel);
    assert.match(parsed.note, /规则识别/);
    assertAccounting(planMeal(scenario));
  }
  assert.equal(planMeal(scenarios[1]).best.totalCents, 3200);
  assert.equal(planMeal(scenarios[2]).best.totalCents, 7200);
  assert.deepEqual(planMeal(scenarios[2]).split.map((p) => p.amountCents), [2400, 2400, 2400]);
});

test('never adds items without consent, even when more food is cheaper', () => {
  const data = custom([offer('large-but-cheap', [item('a'), item('b')], 500)]);
  const input = { items: [item('a')], budgetCents: 700 };
  const exact = planMeal(input, data);
  assert.equal(exact.best.totalCents, 1000);
  assert.equal(exact.best.withinBudget, false);
  assert.equal(exact.best.budgetGapCents, 300);
  assert.equal(exact.flexibleBest.totalCents, 500);
  assert.match(exact.notRecommended[0].reason, /虽然少付/);
  assert.match(exact.warnings.join(), /没有被擅自删减/);
  const consented = planMeal({ ...input, allowExtras: true }, data);
  assert.equal(consented.best.totalCents, 500);
  assert.equal(consented.best.extraCount, 1);
  assert.equal(consented.best.withinBudget, true);
  assertAccounting(consented);
});

test('equal prices prefer zero extras even when extra food is permitted', () => {
  const result = planMeal({ items: [item('a')], allowExtras: true }, custom([offer('same-price-extra', [item('a'), item('b')], 1000)]));
  assert.equal(result.best.totalCents, 1000);
  assert.equal(result.best.extraCount, 0);
});

test('impossible budgets preserve every requested item; zero and no cap are explicit', () => {
  const result = planMeal({ items: [item('a', 2), item('b')], budgetCents: 0 }, custom());
  assert.equal(result.best.totalCents, 2500);
  assert.equal(result.best.withinBudget, false);
  assert.equal(result.best.budgetGapCents, 2500);
  assert.deepEqual(result.requestedItems.map(({ productId, quantity }) => ({ productId, quantity })), [item('a', 2), item('b')]);
  assert.equal(planMeal({ items: [item('a')] }, custom()).budgetCents, null);
  assert.equal(planMeal({ items: [item('a')] }, custom()).best.withinBudget, true);
});

test('duplicate request rows aggregate while duplicate promo IDs are rejected', () => {
  const result = planMeal({ items: [item('a'), item('a', 2)] }, custom());
  assert.equal(result.requestedItems.length, 1);
  assert.equal(result.requestedItems[0].quantity, 3);
  const duplicated = offer('same', [item('a')], 100);
  throwsCode(() => planMeal({ items: [item('a', 2)] }, custom([duplicated, duplicated])), 'DUPLICATE_OFFER');
});

test('offer use limits and mutual exclusivity cannot be bypassed by combining coupons', () => {
  const data = custom([
    offer('a-only', [item('a')], 100, { exclusiveGroup: 'one-member-coupon' }),
    offer('b-only', [item('b')], 100, { exclusiveGroup: 'one-member-coupon' }),
  ]);
  const result = planMeal({ items: [item('a'), item('b')] }, data);
  assert.equal(result.best.totalCents, 600);
  assert.equal(result.best.offers.length, 1);
  const limited = planMeal({ items: [item('a', 3)] }, custom([offer('a-once', [item('a')], 100)]));
  assert.equal(limited.best.totalCents, 2100);
  assert.equal(limited.best.offers[0].uses, 1);
  const twice = planMeal({ items: [item('a', 3)] }, custom([offer('a-twice', [item('a')], 100, { maxUses: 2 })]));
  assert.equal(twice.best.totalCents, 1200);
});

test('expired, not-yet-valid, channel- and store-restricted offers cannot affect the result', () => {
  const data = custom([
    offer('expired', [item('a')], 1, { expiresAt: '2026-10-16T23:59:59+08:00' }),
    offer('future', [item('a')], 2, { startsAt: '2026-10-18T00:00:00+08:00' }),
    offer('delivery', [item('a')], 3, { channels: ['delivery'] }),
    offer('store', [item('a')], 4, { storeIds: ['demo-one'] }),
  ]);
  const result = planMeal({ items: [item('a')], channel: 'pickup' }, data);
  assert.equal(result.best.totalCents, 1000);
  assert.deepEqual(result.discardedOffers.map((o) => o.code).sort(), ['CHANNEL', 'EXPIRED', 'NOT_STARTED', 'STORE_REQUIRED']);
  assert.equal(planMeal({ items: [item('a')], channel: 'pickup', storeId: 'demo-other' }, data).discardedOffers.find((o) => o.id === 'store').code, 'STORE');
  assert.equal(planMeal({ items: [item('a')], channel: 'pickup', storeId: 'demo-one' }, data).best.totalCents, 4);
  const delivery = planMeal({ items: [item('a')], channel: 'delivery', budgetCents: 100 }, data);
  assert.equal(delivery.best.totalCents, 3);
  assert.equal(delivery.amountScope, 'food-only');
  assert.equal(delivery.finalTotalCents, null);
  assert.equal(delivery.comparison.budgetFeasible, null);
  assert.equal(delivery.comparison.foodBudgetFeasible, true);
  assert.match(delivery.warnings.join(), /尚未计入配送费/);
  assert.match(makeReceipt(delivery), /餐品金额预算内，配送等费用未核定/);
});

test('offer dates include exact start/end instants and compare timezones consistently', () => {
  const boundary = '2026-10-17T12:00:00+08:00';
  const data = custom([offer('instant', [item('a')], 123, { startsAt: boundary, expiresAt: boundary })]);
  assert.equal(planMeal({ items: [item('a')], now: '2026-10-17T04:00:00Z' }, data).best.totalCents, 123);
  assert.equal(planMeal({ items: [item('a')], now: new Date('2026-10-17T04:00:00.001Z') }, data).best.totalCents, 1000);
  for (const now of ['nonsense', '2026-10-17', '2026-10-17T12:00:00', '2026-02-30T12:00:00Z', '2026-10-17T24:00:00Z', new Date(NaN), Infinity]) {
    throwsCode(() => planMeal({ items: [item('a')], now }, custom()), 'INVALID_DATE');
  }
  throwsCode(() => planMeal({ items: [item('a')] }, custom([offer('backwards', [item('a')], 10, { startsAt: '2026-10-20T00:00:00Z', expiresAt: '2026-10-19T00:00:00Z' })])), 'INVALID_DATE');
});

test('excluded tags apply to extras as well as intent and cannot silently delete requested food', () => {
  const data = custom([offer('spicy-addon', [item('a'), item('c')], 100)]);
  const result = planMeal({ items: [item('a')], allowExtras: true, excludedTags: ['spicy'] }, data);
  assert.equal(result.best.totalCents, 1000);
  assert.equal(result.discardedOffers[0].code, 'EXCLUDED_ITEM');
  throwsCode(() => planMeal({ items: [item('c')], excludedTags: ['spicy'] }, data), 'EXCLUDED_REQUEST');
});

test('retail is always available and zero-priced valid offers are handled safely', () => {
  assert.equal(planMeal({ items: [item('a')] }, custom()).best.totalCents, 1000);
  const result = planMeal({ items: [item('a')], budgetCents: 0 }, custom([offer('free', [item('a')], 0)]));
  assert.equal(result.best.totalCents, 0);
  assert.equal(result.best.withinBudget, true);
  assertAccounting(result);
});

test('12 serving / 8 product boundary remains supported without losing exact intent', () => {
  const items = catalog.map((p, i) => item(p.id, i < 4 ? 2 : 1));
  const result = planMeal({ items, people: 12, allowExtras: true, budgetCents: 100_000 });
  assert.equal(result.stats.requestedUnits, 12);
  assert.equal(result.best.extraCount, 0);
  assert.equal(result.extraBest, null);
  assertAccounting(result);
  throwsCode(() => planMeal({ items: [...items, item(catalog[0].id)] }), 'CART_LIMIT');
});

test('malformed, non-finite, fractional, unsafe and unknown values fail closed', () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1, null]) {
    throwsCode(() => planMeal({ items: [item('a', quantity)] }, custom()), 'INVALID_INPUT');
  }
  for (const budgetCents of [-1, 0.1, NaN, Infinity, '3000']) {
    throwsCode(() => planMeal({ items: [item('a')], budgetCents }, custom()), 'INVALID_INPUT');
  }
  for (const priceCents of [NaN, Infinity, -1, 1.5, '100']) {
    throwsCode(() => planMeal({ items: [item('a')] }, custom([offer('bad', [item('a')], priceCents)])), 'INVALID_INPUT');
  }
  throwsCode(() => planMeal({ items: [item('a')] }, custom([], [{ id: 'a', name: 'A', priceCents: 0 }])), 'INVALID_INPUT');
  throwsCode(() => planMeal({ items: [item('__proto__')] }, custom()), 'UNKNOWN_PRODUCT');
  throwsCode(() => planMeal({ items: [] }, custom()), 'INVALID_ITEMS');
  throwsCode(() => planMeal({ items: [item('a')], channel: 'teleport' }, custom()), 'INVALID_INPUT');
  throwsCode(() => planMeal({ items: [item('a')], people: 0 }, custom()), 'INVALID_INPUT');
  throwsCode(() => planMeal({ items: [item('a')], allowExtras: 'false' }, custom()), 'INVALID_INPUT');
  throwsCode(() => planMeal({ items: [item('a')] }, custom([offer('bad-use', [item('a')], 10, { maxUses: Infinity })])), 'INVALID_INPUT');
  throwsCode(() => planMeal(null), 'INVALID_INPUT');
});

test('largest-remainder split conserves every cent, with deterministic tie-breaking', () => {
  assert.deepEqual(splitBill(100, 3).map((p) => p.amountCents), [34, 33, 33]);
  assert.deepEqual(splitBill(2, 3).map((p) => p.amountCents), [1, 1, 0]);
  assert.deepEqual(splitBill(0, 3).map((p) => p.amountCents), [0, 0, 0]);
  assert.deepEqual(splitBill(100, [{ name: 'A', weight: 1 }, { name: 'B', weight: 2 }]).map((p) => p.amountCents), [33, 67]);
  const max = splitBill(Number.MAX_SAFE_INTEGER, [{ weight: 999 }, { weight: 1000 }, { weight: 1 }]);
  assert.equal(max.reduce((a, p) => a + p.amountCents, 0), Number.MAX_SAFE_INTEGER);
  for (let total = 0; total < 401; total += 7) {
    for (let people = 1; people <= 12; people += 1) {
      const rows = splitBill(total, people);
      assert.equal(rows.reduce((a, p) => a + p.amountCents, 0), total);
      assert.ok(Math.max(...rows.map((p) => p.amountCents)) - Math.min(...rows.map((p) => p.amountCents)) <= 1);
    }
  }
  throwsCode(() => splitBill(100, [{ weight: 0 }]), 'INVALID_INPUT');
  throwsCode(() => splitBill(100, [{ id: 'same' }, { id: 'same' }]), 'INVALID_SPLIT');
  throwsCode(() => splitBill(100, []), 'INVALID_SPLIT');
});

test('Chinese parser covers names, numeric forms, negatives, full-width digits and exclusions without posing as AI', () => {
  const parsed = parseIntent('两个人，预算七十五点五元，两个板烧、一份麦乐鸡、两杯美式、一份玉米杯，外卖，可以多买，不要可乐，不吃辣');
  assert.equal(parsed.people, 2);
  assert.equal(parsed.budgetCents, 7550);
  assert.equal(parsed.channel, 'delivery');
  assert.equal(parsed.allowExtras, true);
  assert.deepEqual(parsed.items, [item('grilled-burger', 2), item('nuggets'), item('americano', 2), item('corn')]);
  assert.ok(parsed.excludedTags.includes('cola'));
  assert.ok(parsed.excludedTags.includes('spicy'));
  assert.deepEqual(parseIntent('巨无霸2个，中薯1份').items, [item('big-mac', 2), item('fries')]);
  assert.equal(parseIntent('预算３５.５０元，一个麦辣堡').budgetCents, 3550);
  assert.equal(parseIntent('麦乐鸡（5块）').budgetCents, undefined);
  assert.equal(parseIntent('预算-5元，一份薯条').budgetCents, undefined);
  assert.equal(parseIntent('预算12.345元，一份薯条').budgetCents, undefined);
  assert.equal(parseIntent('预算三十五元').budgetCents, 3500);
  assert.equal(parseIntent('十二份薯条').items[0].quantity, 12);
  assert.equal(parseIntent('十三份薯条').items, undefined);
  assert.equal(parseIntent('1.5份薯条').items, undefined);
  assert.equal(parseIntent('<script>alert(1)</script>').items, undefined);
  assert.match(parseIntent('随便推荐').note, /暂未识别/);
  throwsCode(() => parseIntent('a'.repeat(601)), 'INVALID_INTENT');
});

test('receipt is an honest decision record with no invented order confirmation', () => {
  const receipt = makeReceipt(planMeal(scenarios[0]));
  assert.match(receipt, /点餐决策单（演示）/);
  assert.match(receipt, /餐品实付：¥33\.00/);
  assert.match(receipt, /少付：¥16\.00/);
  assert.match(receipt, /不创建订单/);
  assert.match(receipt, /非麦当劳实时价格或官方优惠/);
  throwsCode(() => makeReceipt({}), 'INVALID_RECEIPT');
});

/** Independent, deliberately exhaustive enumerator: no memoization or pruning. */
function bruteForce(products, offers, requestedItems) {
  const indices = new Map(products.map((p, i) => [p.id, i]));
  const need = products.map((p) => requestedItems.find((i) => i.productId === p.id)?.quantity ?? 0);
  let exact = Infinity;
  let flexible = Infinity;
  function visit(i, quantities, paid, groups) {
    if (i === offers.length) {
      const final = quantities.map((q, index) => Math.max(q, need[index]));
      if (final.reduce((a, q) => a + q, 0) > LIMITS.units) return;
      const total = paid + need.reduce((a, q, index) => a + Math.max(0, q - quantities[index]) * products[index].priceCents, 0);
      flexible = Math.min(flexible, total);
      if (quantities.every((q, index) => q <= need[index])) exact = Math.min(exact, total);
      return;
    }
    const o = offers[i];
    const cap = o.exclusiveGroup && groups.has(o.exclusiveGroup) ? 0 : (o.maxUses ?? 1);
    for (let uses = 0; uses <= cap; uses += 1) {
      const next = [...quantities];
      for (const row of o.items) next[indices.get(row.productId)] += row.quantity * uses;
      const nextGroups = new Set(groups);
      if (uses && o.exclusiveGroup) nextGroups.add(o.exclusiveGroup);
      visit(i + 1, next, paid + uses * o.priceCents, nextGroups);
    }
  }
  visit(0, products.map(() => 0), 0, new Set());
  return { exact, flexible };
}

test('exact optimization agrees with independent brute force across 200 seeded random instances', () => {
  let seed = 0x6d63446f;
  const random = (max) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; };
  for (let trial = 0; trial < 200; trial += 1) {
    const products = Array.from({ length: 2 + random(2) }, (_, i) => ({ id: `p${i}`, name: `P${i}`, priceCents: 100 + random(1400) }));
    const requestedItems = products.filter(() => random(4) !== 0).map((p) => item(p.id, 1 + random(2)));
    if (!requestedItems.length) requestedItems.push(item(products[0].id));
    const offers = Array.from({ length: 1 + random(5) }, (_, i) => {
      const bundle = products.filter(() => random(3) !== 0).map((p) => item(p.id, 1 + random(2)));
      if (!bundle.length) bundle.push(item(products[0].id));
      return offer(`o${i}`, bundle, random(1800), { maxUses: 1 + random(2), ...(random(3) === 0 ? { exclusiveGroup: `group-${random(2)}` } : {}) });
    });
    const expected = bruteForce(products, offers, requestedItems);
    const data = custom(offers, products);
    const strict = planMeal({ items: requestedItems, allowExtras: false, people: 3 }, data);
    const flexible = planMeal({ items: requestedItems, allowExtras: true }, data);
    assert.equal(strict.best.totalCents, expected.exact, `exact trial ${trial}`);
    assert.equal(strict.flexibleBest.totalCents, expected.flexible, `flexible preview trial ${trial}`);
    assert.equal(flexible.best.totalCents, expected.flexible, `flexible trial ${trial}`);
    assert.equal(strict.best.extraCount, 0);
    assertAccounting(strict);
    assertAccounting(flexible);
  }
});

test('inputs and frozen fixture data are never mutated by planning or parsing', () => {
  const input = JSON.parse(JSON.stringify(scenarios[0]));
  const before = JSON.stringify(input);
  const fixtureBefore = JSON.stringify({ catalog, demoOffers });
  planMeal(input);
  parseIntent(scenarios[0].prompt);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify({ catalog, demoOffers }), fixtureBefore);
});
