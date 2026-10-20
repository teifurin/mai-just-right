import { McdClient, McpError, MCD_ENDPOINT, READ_ONLY_TOOLS } from './mcp-client.mjs';
import { compareOfficialQuotes } from './quote-comparison.mjs';
import { loadPickupProfile, pickupStores, pickupCatalog, pickupRecommend } from './pickup-flow.mjs';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' } });
export function mcpStatus(env = {}) {
  return response({ configured: Boolean(env.MCD_MCP_TOKEN?.trim()), mode: env.MCD_MCP_TOKEN?.trim() ? 'live' : 'demo', endpoint: MCD_ENDPOINT, liveVerified: false, note: '配置状态不代表已经完成真实调用；请点击连接并查看返回结果。', allowedTools: READ_ONLY_TOOLS });
}

export async function handleMcpRequest(request, env = {}, clientFactory = options => new McdClient(options)) {
  if (request.method !== 'POST') return response({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, 405);
  const url = new URL(request.url), origin = request.headers.get('origin');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const local = loopback && env.MCD_ALLOW_LOCAL === '1';
  // Identity headers are only trusted behind the explicitly configured Sites
  // gateway. A copied/self-hosted app must reject client-supplied identity
  // headers by default, and a shared deployment must not expose the owner's
  // McDonald's account to other signed-in visitors.
  const owner = env.MCD_OWNER_USER_ID?.trim();
  const hostedOwner = !loopback && env.MCD_TRUST_SITES_IDENTITY === '1'
    && Boolean(owner) && request.headers.get('oai-authenticated-user-id') === owner;
  if (!local && !hostedOwner) return response({ error: { code: 'SIGN_IN_REQUIRED', message: '当前请求无权访问账户数据。本地调试需显式设置 MCD_ALLOW_LOCAL=1；托管访问需配置可信身份来源与账户所有者。' } }, 401);
  if (origin && origin !== url.origin) return response({ error: { code: 'ORIGIN_REJECTED', message: '不接受跨站账户请求。' } }, 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: { code: 'ORIGIN_REJECTED', message: '不接受跨站账户请求。' } }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return response({ error: { code: 'INVALID_CONTENT_TYPE', message: '请求必须是 JSON。' } }, 415);
  let client;
  try {
    const reader = request.body?.getReader();
    let raw = '', count = 0;
    const decoder = new TextDecoder();
    if (!reader) throw new McpError('EMPTY_REQUEST', '请求内容为空。', 400);
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; count += value.byteLength; if (count > 65536) throw new McpError('REQUEST_TOO_LARGE', '请求超过 64 KiB。', 413); raw += decoder.decode(value, { stream: true }); }
      raw += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    let body;
    try { body = JSON.parse(raw); } catch { throw new McpError('INVALID_JSON', 'JSON 格式不正确。', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new McpError('INVALID_REQUEST', '请求必须是对象。', 400);
    if (!['discover', 'snapshot', 'call', 'compare', 'pickup-stores', 'pickup-catalog', 'pickup-recommend'].includes(body.action)) throw new McpError('INVALID_ACTION', '未知操作。', 400);
    client = clientFactory({ token: env.MCD_MCP_TOKEN });
    if (body.action.startsWith('pickup-')) {
      const profile = loadPickupProfile(env);
      if (body.action === 'pickup-stores') return response(await pickupStores(client, profile, body.search));
      if (body.action === 'pickup-catalog') return response(await pickupCatalog(client, profile, body.storeId));
      return response(await pickupRecommend(client, profile, body));
    }
    if (body.action === 'discover') {
      const tools = await client.listTools();
      return response({ source: 'live', endpoint: MCD_ENDPOINT, connected: true, protocolVersion: client.protocolVersion, serverInfo: client.serverInfo, tools: tools.filter(t => t.readOnlyAllowed), hiddenWriteTools: tools.filter(t => !t.readOnlyAllowed).length, audit: client.audit });
    }
    if (body.action === 'snapshot') {
      const snapshot = await client.snapshot();
      const succeeded = snapshot.results.some(row => !row.error);
      return response({
        ...snapshot,
        liveBusinessCallSucceeded: succeeded,
        ...(!succeeded ? { error: { code: 'NO_SUCCESSFUL_QUERY', message: '本次没有成功的只读查询，请核对接口返回后重试。' } } : {}),
      }, succeeded ? 200 : 502);
    }
    if (body.action === 'compare') return response(await compareOfficialQuotes(client, body.request));
    return response(await client.callTool(body.name, body.arguments ?? {}));
  } catch (error) {
    if (error instanceof McpError) return response({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status);
    return response({ error: { code: 'INTERNAL_ERROR', message: '请求处理失败，请稍后重试。' } }, 500);
  } finally { if (client) await client.close(); }
}
