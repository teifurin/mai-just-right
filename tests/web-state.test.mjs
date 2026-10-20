import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, planMeal } from '../core/index.mjs';
import { decodeDecisions, encodeDecisions, normalizeSavedInput, availableQuantity } from '../app/lib/demo-state.mjs';
const input = { ...scenarios[0] };
const row = { id: 'safe', savedAt: '2026-10-20T00:00:00Z', input, result: planMeal(input) };

test('stored partial/tampered result is recomputed from validated demo input', () => {
  const [restored] = decodeDecisions(JSON.stringify([{ ...row, result: { source: 'demo', best: { totalCents: -99, items: [] }, alternatives: [] } }]));
  assert.equal(restored.result.best.totalCents, planMeal(input).best.totalCents);
  assert.ok(restored.result.best.offers);
  assert.ok(restored.result.stats);
});

test('malformed, unknown, duplicate, oversized and non-demo history is rejected', () => {
  for (const bad of [null, { ...input, items: [null] }, { ...input, items: [{ productId: 'unknown', quantity: 1 }] }, { ...input, items: [...input.items, input.items[0]] }, { ...input, items: [{ ...input.items[0], quantity: 13 }] }, { ...input, people: 100 }, { ...input, budgetCents: -1 }, { ...input, channel: 'invalid' }, { ...input, allowExtras: 'false' }, { ...input, excludedTags: [null] }]) {
    assert.deepEqual(decodeDecisions(JSON.stringify([{ ...row, input: bad }])), []);
  }
  assert.deepEqual(decodeDecisions(JSON.stringify([{ ...row, result: { source: 'live' } }])), []);
  assert.deepEqual(decodeDecisions('{'), []);
  assert.deepEqual(decodeDecisions(' '.repeat(500001)), []);
});

test('saved history stores only whitelisted demo input, not result or private metadata', () => {
  const encoded = encodeDecisions([{ ...row, input: { ...input, token: 'private-marker', storeId: 'private-store' }, result: { ...row.result, raw: 'private-marker' } }]);
  assert.ok(!encoded.includes('private-marker'));
  assert.ok(!encoded.includes('private-store'));
  assert.ok(!encoded.includes('result'));
  assert.equal(decodeDecisions(encoded).length, 1);
});

test('history caps count, rejects duplicate IDs and global quantity uses engine limit', () => {
  const rows = Array.from({ length: 35 }, (_, i) => ({ ...row, id: `row-${i}` }));
  assert.equal(decodeDecisions(JSON.stringify(rows)).length, 30);
  assert.equal(decodeDecisions(JSON.stringify([row, row])).length, 1);
  assert.equal(availableQuantity([{ productId: 'a', quantity: 7 }, { productId: 'b', quantity: 5 }], 'a'), 7);
  assert.equal(availableQuantity([{ productId: 'a', quantity: 12 }], 'b'), 0);
  assert.equal(normalizeSavedInput({ ...input, items: [{ productId: input.items[0].productId, quantity: 12 }, { productId: input.items[1].productId, quantity: 1 }] }), null);
});

test('new meal resets stale exclusions; negative-only edit removes only explicitly excluded prior items', async () => {
  const { mergeParsedIntent } = await import('../app/lib/demo-state.mjs');
  const { parseIntent } = await import('../core/index.mjs');
  const previous = { ...input, excludedTags: ['spicy'] };
  assert.deepEqual(mergeParsedIntent(previous, { items: input.items }).input.excludedTags, []);
  assert.deepEqual(mergeParsedIntent(previous, { budgetCents: 6000 }).input.excludedTags, ['spicy']);
  const values = parseIntent('不要可乐');
  delete values.note; delete values.recognized;
  const edited = mergeParsedIntent(input, values);
  assert.ok(!edited.input.items.some((item) => item.productId === 'cola'));
  assert.deepEqual(edited.removedNames, ['中可乐']);
  assert.equal(edited.input.items.length, input.items.length - 1);
});
