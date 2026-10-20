import { McpError } from './mcp-client.mjs';

function extractData(result) {
  if (result && Object.hasOwn(result, 'structuredContent')) return result.structuredContent;
  const text = result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (!text) throw new McpError('QUOTE_NOT_STRUCTURED', '官方核价结果没有可解析的 JSON；请在 Agent 中查看原始结果，不能使用演示价格替代。', 422);
  try { return JSON.parse(text); } catch { throw new McpError('QUOTE_NOT_STRUCTURED', '官方核价文本不是 JSON；请在 Agent 中核对原始应付金额。', 422); }
}

export function moneyToCents(value, unit) {
  if (!['yuan', 'fen'].includes(unit)) throw new McpError('UNIT_REQUIRED', '请明确官方金额字段使用 yuan 还是 fen。', 400);
  if (!['string', 'number'].includes(typeof value)) throw new McpError('INVALID_PRICE', '官方应付金额字段缺失或类型不正确。', 422);
  const raw = String(value);
  if (!(unit === 'fen' ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(raw)) throw new McpError('INVALID_PRICE', '官方金额必须是非负数，元金额最多两位小数。', 422);
  const [whole, fraction = ''] = raw.split('.');
  const cents = unit === 'fen' ? Number(whole) : Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 1_000_000) throw new McpError('INVALID_PRICE', '官方金额超出单次餐品核价范围。', 422);
  return cents;
}

/** Caller supplies genuine tool arguments and the documented payable-total path.
 * No store/product IDs, field names, money units, or coupon stackability are guessed. */
export async function compareOfficialQuotes(client, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new McpError('INVALID_COMPARISON', '核价对比请求必须是对象。', 400);
  if (!Array.isArray(request.totalPath) || request.totalPath.length < 1 || request.totalPath.length > 12 || request.totalPath.some(k => typeof k !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(k) || k.length > 100)) throw new McpError('PATH_REQUIRED', 'totalPath 必须是官方应付总额字段的路径数组。', 400);
  if (!['yuan', 'fen'].includes(request.unit)) throw new McpError('UNIT_REQUIRED', '请明确官方金额字段使用 yuan 还是 fen。', 400);
  if (!request.baseline || !Array.isArray(request.candidates) || request.candidates.length < 1 || request.candidates.length > 5) throw new McpError('INVALID_CANDIDATES', '需要一个基准方案和一至五个候选方案。', 400);
  const candidates = [request.baseline, ...request.candidates];
  for (const item of candidates) {
    if (typeof item?.title !== 'string' || !item.title.trim() || item.title.length > 100 || !item.arguments || typeof item.arguments !== 'object' || Array.isArray(item.arguments)) throw new McpError('INVALID_CANDIDATE', '每个方案需要 title 和按官方 Schema 填写的 arguments。', 400);
    if (item.extraCount !== undefined && (!Number.isInteger(item.extraCount) || item.extraCount < 0 || item.extraCount > 12)) throw new McpError('INVALID_EXTRAS', 'extraCount 必须是 0–12 的整数。', 400);
  }
  const quoted = [];
  for (const item of candidates) {
    const quote = await client.callTool('calculate-price', item.arguments);
    let value = extractData(quote.result);
    for (const key of request.totalPath) value = value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
    quoted.push({ title: item.title, totalCents: moneyToCents(value, request.unit), extraCount: item.extraCount ?? null, fetchedAt: quote.fetchedAt, source: 'live', tool: 'calculate-price' });
  }
  const [baseline, ...options] = quoted;
  const results = options.map(item => ({ ...item, savingCents: baseline.totalCents - item.totalCents })).sort((a, b) => a.totalCents - b.totalCents || (a.extraCount ?? 99) - (b.extraCount ?? 99));
  const best = results[0].totalCents < baseline.totalCents ? results[0] : { ...baseline, savingCents: 0, extraCount: 0 };
  return { source: 'live', currency: 'CNY', baseline, candidates: results, best, verifiedAt: new Date().toISOString(), comparisonScope: '逐个请求的官方应付总额；方案描述及多买件数由调用方提供，需核对同一门店、渠道、时段与原始需求。', note: '核价不锁定价格，也不创建订单；最终以官方结算为准。' };
}
