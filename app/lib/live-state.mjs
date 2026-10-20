const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every(text);
const store = (value) => record(value) && text(value.id) && text(value.name);
const products = (value) => Array.isArray(value) && value.length > 0 && value.length <= 8 && value.every(store) && new Set(value.map((row) => row.id)).size === value.length;
const items = (value) => Array.isArray(value) && value.length <= 8 && value.every((row) => record(row) && text(row.productId) && Number.isSafeInteger(row.quantity) && row.quantity >= 1 && row.quantity <= 12) && value.reduce((sum, row) => sum + row.quantity, 0) <= 12 && new Set(value.map((row) => row.productId)).size === value.length;
const quote = (value) => record(value) && text(value.title) && Number.isSafeInteger(value.totalCents) && value.totalCents >= 0 && items(value.items) && value.items.length > 0 && items(value.extraItems);
export function isLiveStores(value) {
  return record(value) && value.source === 'live' && Array.isArray(value.stores) && value.stores.length <= 50 && value.stores.every(store) && new Set(value.stores.map((row) => row.id)).size === value.stores.length;
}
export function isLiveCatalog(value, storeId) {
  return record(value) && value.source === 'live' && value.channel === 'pickup' && store(value.store) && value.store.id === storeId && products(value.products) && Array.isArray(value.offers) && value.offers.length <= 16 && value.offers.every((row) => record(row) && text(row.id) && text(row.title) && items(row.coverage) && row.coverage.length > 0 && row.coverage.every((item) => value.products.some((product) => product.id === item.productId))) && new Set(value.offers.map((row) => row.id)).size === value.offers.length && Array.isArray(value.coupons) && value.coupons.every((row) => record(row) && text(row.title)) && text(value.scope) && strings(value.warnings);
}
const sameItems = (left, right) => left.length === right.length && left.every((item) => right.some((other) => item.productId === other.productId && item.quantity === other.quantity));
export function isLiveRecommendation(value, storeId, budgetCents, demand, allowExtras = false) {
  if (!(record(value) && value.source === 'live' && value.channel === 'pickup' && store(value.store) && value.store.id === storeId && items(value.demand) && value.demand.length > 0 && quote(value.baseline) && Array.isArray(value.candidates) && value.candidates.length <= 5 && value.candidates.every(quote) && quote(value.best) && value.budgetCents === budgetCents && typeof value.withinBudget === 'boolean' && value.withinBudget === (value.best.totalCents <= budgetCents) && text(value.verifiedAt) && Number.isFinite(Date.parse(value.verifiedAt)) && text(value.scope) && strings(value.warnings))) return false;
  if (demand && !sameItems(value.demand, demand)) return false;
  if (!sameItems(value.baseline.items, value.demand) || value.baseline.extraItems.length) return false;
  const quotes = [value.baseline, ...value.candidates];
  for (const candidate of [...quotes, value.best]) {
    if (value.demand.some((item) => !candidate.items.some((food) => food.productId === item.productId && food.quantity >= item.quantity))) return false;
    const extras = candidate.items.map((food) => ({ productId: food.productId, quantity: food.quantity - (value.demand.find((item) => item.productId === food.productId)?.quantity ?? 0) })).filter((item) => item.quantity > 0);
    if (!sameItems(extras, candidate.extraItems) || (!allowExtras && extras.length)) return false;
  }
  return quotes.some((candidate) => candidate.title === value.best.title && candidate.totalCents === value.best.totalCents && sameItems(candidate.items, value.best.items));
}
