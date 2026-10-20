import { assertPlainArguments, validateArguments } from './schema.mjs';

export const MCD_ENDPOINT = 'https://mcp.mcd.cn';
export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26'];
export const READ_ONLY_TOOLS = Object.freeze([
  'now-time-info', 'campaign-calendar', 'available-coupons', 'query-my-coupons',
  'query-my-account', 'query-nearby-stores', 'query-store-coupons', 'query-meals',
  'query-meal-detail', 'calculate-price', 'list-nutrition-foods',
  'delivery-query-addresses', 'delivery-query-stores', 'query-meal-assistance',
  'mall-points-products', 'mall-product-detail',
]);
const SAFE_NAMES = new Set(READ_ONLY_TOOLS);
const MAX_BYTES = 2 * 1024 * 1024;

export class McpError extends Error {
  constructor(code, message, status = 502, details = undefined) {
    super(message); this.name = 'McpError'; this.code = code; this.status = status; this.details = details;
  }
}

function decodeMessage(value, id) {
  if (!value || value.jsonrpc !== '2.0' || value.id !== id) return undefined;
  if (value.error) throw new McpError('RPC_ERROR', `麦当劳 MCP 返回协议错误（${Number(value.error.code) || 'unknown'}）；请按实时工具参数重新检查。`);
  if (!Object.hasOwn(value, 'result')) throw new McpError('INVALID_RESPONSE', 'MCP 响应缺少 result。');
  return value.result;
}

/** Both JSON and a finite response on a long-lived SSE stream are supported. */
export async function readRpcResponse(response, id, onServerRequest = async () => {}) {
  if (!response.body) throw new McpError('EMPTY_RESPONSE', 'MCP 返回了空响应。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = (response.headers.get('content-type') ?? '').includes('text/event-stream');
  let buffer = '', bytes = 0;
  const parse = (raw) => { try { return JSON.parse(raw); } catch { throw new McpError('INVALID_JSON', 'MCP 返回格式无法解析。'); } };
  const dispatch = async value => {
    if (value?.jsonrpc === '2.0' && typeof value.method === 'string') {
      if (Object.hasOwn(value, 'id')) await onServerRequest(value);
      return undefined;
    }
    return decodeMessage(value, id);
  };
  const eventResult = async (event) => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    return data ? dispatch(parse(data)) : undefined;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) { bytes += value.byteLength; if (bytes > MAX_BYTES) throw new McpError('RESPONSE_TOO_LARGE', 'MCP 响应超过 2 MiB 限制。'); buffer += decoder.decode(value, { stream: true }); }
      if (done) buffer += decoder.decode();
      if (sse) {
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const result = await eventResult(event);
          if (result !== undefined) return result;
        }
        if (done && buffer.trim()) { const result = await eventResult(buffer); if (result !== undefined) return result; }
      } else if (done) {
        const result = await dispatch(parse(buffer));
        if (result !== undefined) return result;
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
  throw new McpError('MISSING_RESPONSE', 'MCP 响应没有匹配的请求 ID。');
}

export class McdClient {
  #token; #fetch; #timeout;
  constructor({ token, fetchImpl = globalThis.fetch, timeoutMs = 18000 } = {}) {
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token) || token.length > 8192 || /^(?:YOUR_|\$\{)/.test(token.trim())) throw new McpError('TOKEN_REQUIRED', '请在服务端配置 MCD_MCP_TOKEN，再连接真实麦当劳账户。', 503);
    this.#token = token.trim(); this.#fetch = fetchImpl; this.#timeout = timeoutMs;
    this.sequence = 0; this.sessionId = undefined; this.protocolVersion = SUPPORTED_PROTOCOLS[0]; this.initialized = false; this.tools = null; this.audit = [];
  }

  async #respondToServer(message) {
    if (!(typeof message.id === 'string' || Number.isSafeInteger(message.id))) throw new McpError('INVALID_SERVER_REQUEST', 'MCP 服务端请求 ID 无效。');
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.#token}`, 'MCP-Protocol-Version': this.protocolVersion };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const body = { jsonrpc: '2.0', id: message.id, ...(message.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'Client capability is not available.' } }) };
    const response = await this.#fetch(MCD_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: 'error' });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw new McpError('SERVER_REQUEST_RESPONSE_FAILED', '无法回复 MCP 服务端的协议请求。');
  }

  async #post(method, params, notification = false) {
    const id = notification ? undefined : ++this.sequence;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    const start = Date.now();
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.#token}` };
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      if (this.initialized || method === 'notifications/initialized') headers['MCP-Protocol-Version'] = this.protocolVersion;
      const response = await this.#fetch(MCD_ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) }), signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) throw new McpError('AUTH_FAILED', 'MCP Token 无效、过期或没有访问权限，请在官方控制台核对。', 401);
        if (response.status === 429) throw new McpError('RATE_LIMITED', '官方 MCP 请求过于频繁，请稍后重试。', 429);
        if (response.status === 404 && this.sessionId) throw new McpError('SESSION_EXPIRED', 'MCP 会话已过期。');
        throw new McpError('HTTP_ERROR', `官方 MCP 暂时无法响应（HTTP ${response.status}）。`);
      }
      if (method === 'initialize') {
        const session = response.headers.get('Mcp-Session-Id');
        if (session && !/^[\x21-\x7e]{1,1024}$/.test(session)) throw new McpError('INVALID_SESSION', 'MCP 会话标识无效。');
        this.sessionId = session || undefined;
      }
      if (notification) { await response.body?.cancel().catch(() => {}); return null; }
      const result = await readRpcResponse(response, id, message => this.#respondToServer(message));
      this.audit.push({ method, ...(method === 'tools/call' ? { tool: params.name } : {}), ok: true, durationMs: Date.now() - start });
      return result;
    } catch (error) {
      this.audit.push({ method, ...(method === 'tools/call' ? { tool: params.name } : {}), ok: false, durationMs: Date.now() - start });
      if (error instanceof McpError) throw error;
      if (controller.signal.aborted) throw new McpError('TIMEOUT', '官方 MCP 连接超时，请稍后重试。', 504);
      // Do not expose upstream bodies, request headers, fetch errors, or tokens.
      throw new McpError('NETWORK_ERROR', '无法连接官方 MCP，请检查网络后重试。');
    } finally { clearTimeout(timer); }
  }

  async rpc(method, params) {
    try { return await this.#post(method, params); }
    catch (error) {
      if (error.code !== 'SESSION_EXPIRED' || method === 'initialize') throw error;
      this.initialized = false; this.sessionId = undefined; this.tools = null;
      await this.initialize();
      return this.#post(method, params);
    }
  }

  async initialize() {
    if (this.initialized) return this.serverInfo;
    const result = await this.#post('initialize', { protocolVersion: SUPPORTED_PROTOCOLS[0], capabilities: {}, clientInfo: { name: 'mai-just-right', version: '1.0.0' } });
    if (!SUPPORTED_PROTOCOLS.includes(result.protocolVersion)) throw new McpError('UNSUPPORTED_PROTOCOL', '官方服务返回了当前客户端尚不支持的 MCP 协议版本。');
    this.protocolVersion = result.protocolVersion;
    this.serverInfo = result.serverInfo ?? {};
    await this.#post('notifications/initialized', undefined, true);
    this.initialized = true;
    return this.serverInfo;
  }

  async listTools() {
    await this.initialize();
    if (this.tools) return this.tools;
    const found = [], cursors = new Set();
    let cursor;
    for (let page = 0; page < 16; page++) {
      const result = await this.rpc('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(result.tools)) throw new McpError('INVALID_TOOLS', '官方工具列表格式异常。');
      for (const tool of result.tools) if (tool && typeof tool.name === 'string') found.push({ name: tool.name, description: String(tool.description ?? ''), inputSchema: tool.inputSchema ?? { type: 'object' }, readOnlyAllowed: SAFE_NAMES.has(tool.name) });
      if (found.length > 256) throw new McpError('TOO_MANY_TOOLS', '工具列表超出安全处理上限。');
      if (!result.nextCursor) { this.tools = found; return found; }
      if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor)) throw new McpError('INVALID_CURSOR', '工具列表分页游标异常。');
      cursors.add(result.nextCursor); cursor = result.nextCursor;
    }
    throw new McpError('TOO_MANY_PAGES', '工具列表分页超出上限。');
  }

  async callTool(name, args = {}) {
    if (!SAFE_NAMES.has(name)) throw new McpError('TOOL_NOT_ALLOWED', '本项目仅开放查询与核价工具，不执行领券、下单、积分兑换或抽奖。', 403);
    try { assertPlainArguments(args); } catch (error) { throw new McpError('INVALID_ARGUMENTS', error.message, 400); }
    const tool = (await this.listTools()).find(t => t.name === name);
    if (!tool) throw new McpError('TOOL_UNAVAILABLE', '当前官方服务未提供这个工具。', 400);
    const errors = validateArguments(args, tool.inputSchema);
    if (errors.length) throw new McpError('SCHEMA_MISMATCH', '参数不符合官方实时 Schema。', 400, errors);
    const result = await this.rpc('tools/call', { name, arguments: args });
    const structured = result?.structuredContent;
    const validContent = Array.isArray(result?.content) && result.content.every(item => item && typeof item === 'object' && typeof item.type === 'string');
    const validStructured = structured !== null && typeof structured === 'object' && !Array.isArray(structured);
    if (!result || typeof result !== 'object' || Array.isArray(result) || (!validContent && !validStructured)) {
      this.audit[this.audit.length - 1].ok = false;
      throw new McpError('INVALID_TOOL_RESULT', '官方工具没有返回有效的业务结果，不能记为真实调用成功。', 502);
    }
    // The live service also carries application failures in its business JSON.
    // A successful JSON-RPC envelope alone must not become success evidence.
    const businessPayloads = [structured];
    for (const part of Array.isArray(result.content) ? result.content : []) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        try { businessPayloads.push(JSON.parse(part.text)); } catch { /* Plain text is valid MCP content. */ }
      }
    }
    const businessFailed = businessPayloads.some(payload => payload && typeof payload === 'object' && !Array.isArray(payload) && payload.success === false);
    if (result?.isError || businessFailed) { this.audit[this.audit.length - 1].ok = false; throw new McpError('TOOL_ERROR', '官方工具未成功处理请求，请核对门店、券和参数后重试。', 422); }
    return { source: 'live', tool: name, fetchedAt: new Date().toISOString(), result };
  }

  async snapshot() {
    const tools = await this.listTools(), results = [], skipped = [];
    for (const name of ['now-time-info', 'query-my-coupons', 'available-coupons', 'campaign-calendar']) {
      const tool = tools.find(t => t.name === name);
      if (!tool) { skipped.push({ name, reason: '当前服务未提供' }); continue; }
      if (validateArguments({}, tool.inputSchema).length) { skipped.push({ name, reason: '需按实时 Schema 填写参数', inputSchema: tool.inputSchema }); continue; }
      try { results.push(await this.callTool(name, {})); }
      catch (error) { results.push({ source: 'live', tool: name, error: { code: error.code, message: error.message } }); }
    }
    return { source: 'live', fetchedAt: new Date().toISOString(), results, skipped, audit: [...this.audit] };
  }

  async close() {
    if (!this.sessionId) return;
    try {
      const response = await this.#fetch(MCD_ENDPOINT, { method: 'DELETE', headers: { Authorization: `Bearer ${this.#token}`, 'Mcp-Session-Id': this.sessionId, 'MCP-Protocol-Version': this.protocolVersion }, signal: AbortSignal.timeout(2000), redirect: 'error' });
      await response.body?.cancel().catch(() => {});
    } catch { /* Some valid MCP servers do not implement DELETE. */ }
    this.sessionId = undefined; this.initialized = false; this.tools = null;
  }
}

/** Export evidence metadata, never account payloads, coupon IDs or credentials. */
export function integrationEvidence(client, outcome) {
  const calls = client.audit.filter(row => row.method === 'tools/call');
  return { application: 'mai-just-right', version: '1.0.0', source: 'live', endpoint: MCD_ENDPOINT, generatedAt: new Date().toISOString(), protocolVersion: client.protocolVersion, liveBusinessCallSucceeded: calls.some(row => row.ok), outcome, calls: client.audit.map(({ method, tool, ok, durationMs }) => ({ method, ...(tool ? { tool } : {}), ok, durationMs })), includesAccountData: false };
}
