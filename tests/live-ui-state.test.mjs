import test from 'node:test';
import assert from 'node:assert/strict';
import { isLiveStores, isLiveCatalog, isLiveRecommendation } from '../app/lib/live-state.mjs';
const store = { id: 'mock-only', name: 'Synthetic store' };
const catalog = { source: 'live', channel: 'pickup', store, products: [{ id: 'p', name: 'Synthetic food' }], offers: [{ id: 'o', title: 'Synthetic offer', coverage: [{ productId: 'p', quantity: 1 }] }], coupons: [], scope: 'Synthetic bounded test, not real MCP', warnings: [] };
const quote = { title: 'Synthetic quote', totalCents: 100, items: [{ productId: 'p', quantity: 1 }], extraItems: [] };
const recommendation = { source: 'live', channel: 'pickup', store, demand: quote.items, baseline: quote, candidates: [], best: quote, budgetCents: 200, withinBudget: true, verifiedAt: '2026-10-20T00:00:00Z', scope: catalog.scope, warnings: [] };

test('UI accepts bounded matching live response shapes, rejects demo and malformed schema', () => {
  assert.equal(isLiveStores({ source: 'live', stores: [store] }), true);
  assert.equal(isLiveStores({ source: 'demo', stores: [store] }), false);
  assert.equal(isLiveStores({ source: 'live', stores: [null] }), false);
  assert.equal(isLiveCatalog(catalog, store.id), true);
  for (const update of [{ source: 'demo' }, { store: { ...store, id: 'other' } }, { products: [null] }, { offers: [{ id: 'a', title: 'Bad offer', coverage: [{ productId: 'unknown', quantity: 1 }] }] }, { warnings: null }, { coupons: [null] }]) assert.equal(isLiveCatalog({ ...catalog, ...update }, store.id), false);
});

test('UI refuses incomplete prices and mismatching store/budget or invalid quote arrays', () => {
  assert.equal(isLiveRecommendation(recommendation, store.id, 200), true);
  for (const update of [{ source: 'demo' }, { budgetCents: 999 }, { withinBudget: false }, { verifiedAt: 'invalid' }, { candidates: [null] }, { best: { ...quote, totalCents: -1 } }, { baseline: { ...quote, items: null } }, { best: { ...quote, extraItems: null } }]) assert.equal(isLiveRecommendation({ ...recommendation, ...update }, store.id, 200), false);
});

test('UI enforces same demand, explicit extra permission and full quote coverage', () => {
  assert.equal(isLiveRecommendation(recommendation, store.id, 200, [{ productId: 'p', quantity: 2 }]), false);
  const extra = { ...quote, title: 'Extra', items: [{ productId: 'p', quantity: 2 }], extraItems: [{ productId: 'p', quantity: 1 }] };
  const withExtra = { ...recommendation, candidates: [extra], best: extra };
  assert.equal(isLiveRecommendation(withExtra, store.id, 200, quote.items, false), false);
  assert.equal(isLiveRecommendation(withExtra, store.id, 200, quote.items, true), true);
  assert.equal(isLiveRecommendation({ ...withExtra, best: { ...extra, extraItems: [] } }, store.id, 200, quote.items, true), false);
  assert.equal(isLiveRecommendation({ ...recommendation, best: { ...quote, totalCents: 1 } }, store.id, 200, quote.items), false);
  assert.equal(isLiveRecommendation({ ...recommendation, best: { ...quote, totalCents: NaN } }, store.id, 200, quote.items), false);
});
