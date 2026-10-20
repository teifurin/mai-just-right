import { catalog, DEMO_NOW, LIMITS, planMeal } from '../../core/index.mjs';

const productIds = new Set(catalog.map((product) => product.id));
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Browser storage is untrusted. Whitelist inputs and recompute, never render a stored result. */
export function normalizeSavedInput(value) {
  if (!record(value) || !Array.isArray(value.items) || !value.items.length || value.items.length > LIMITS.products) return null;
  const seen = new Set();
  const items = [];
  for (const item of value.items) {
    if (!record(item) || !productIds.has(item.productId) || seen.has(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > LIMITS.units) return null;
    seen.add(item.productId);
    items.push({ productId: item.productId, quantity: item.quantity });
  }
  if (items.reduce((sum, item) => sum + item.quantity, 0) > LIMITS.units || !Number.isSafeInteger(value.budgetCents) || value.budgetCents < 1 || value.budgetCents > 999900 || !Number.isSafeInteger(value.people) || value.people < 1 || value.people > LIMITS.people || typeof value.allowExtras !== 'boolean' || !['pickup', 'delivery'].includes(value.channel)) return null;
  const tags = value.excludedTags ?? [];
  if (!Array.isArray(tags) || tags.length > 24 || tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 80)) return null;
  return { items, budgetCents: value.budgetCents, people: value.people, allowExtras: value.allowExtras, channel: value.channel, excludedTags: [...new Set(tags)], now: DEMO_NOW };
}

export function decodeDecisions(text) {
  if (typeof text !== 'string' || text.length > 500000) return [];
  let rows;
  try { rows = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  const decisions = [];
  const ids = new Set();
  for (const row of rows.slice(0, 100)) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || row.id.length > 100 || ids.has(row.id) || typeof row.savedAt !== 'string' || row.savedAt.length > 40 || !Number.isFinite(Date.parse(row.savedAt)) || (row.source ?? row.result?.source) !== 'demo') continue;
    const input = normalizeSavedInput(row.input);
    if (!input) continue;
    try {
      const result = planMeal(input);
      decisions.push({ id: row.id, savedAt: row.savedAt, input, result });
      ids.add(row.id);
      if (decisions.length === 30) break;
    } catch { /* A formerly valid preference may no longer fit the demo catalog. */ }
  }
  return decisions;
}

export function encodeDecisions(decisions) {
  return JSON.stringify(decisions.slice(0, 30).map(({ id, savedAt, input }) => ({ id, savedAt, source: 'demo', input: normalizeSavedInput(input) })).filter((row) => row.input));
}

export function availableQuantity(items, productId) {
  return Math.max(0, LIMITS.units - items.filter((item) => item.productId !== productId).reduce((sum, item) => sum + item.quantity, 0));
}

/** A newly recognized meal replaces old meal exclusions; a negative-only edit removes matching old items. */
export function mergeParsedIntent(previous, values) {
  const replacedMeal = Array.isArray(values.items);
  const excludedTags = values.excludedTags ?? (replacedMeal ? [] : previous.excludedTags ?? []);
  const removedNames = [];
  let items = values.items ?? previous.items;
  if (!replacedMeal && Array.isArray(values.excludedTags) && values.excludedTags.length) {
    items = items.filter((item) => {
      const product = catalog.find((entry) => entry.id === item.productId);
      const excluded = product?.tags.some((tag) => excludedTags.includes(tag));
      if (excluded) removedNames.push(product.name);
      return !excluded;
    });
  }
  return { input: { ...previous, ...values, items, excludedTags, now: DEMO_NOW }, removedNames };
}
