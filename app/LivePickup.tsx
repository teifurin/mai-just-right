"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Info, Loader2, Minus, Plus, Search, ShieldCheck, ShoppingBag } from "lucide-react";

import { isLiveStores, isLiveCatalog, isLiveRecommendation } from "./lib/live-state.mjs";

type Store = { id: string; name: string };
type Product = { id: string; name: string };
type Item = { productId: string; quantity: number; name?: string };
type Catalog = { source: "live"; store: Store; channel: "pickup"; products: Product[]; offers: { id: string; title: string; coverage: Item[] }[]; coupons: { title: string }[]; limits: { products: number; offers: number; candidates: number }; scope: string; warnings: string[] };
type Quote = { title: string; totalCents: number; items: Item[]; extraItems: Item[]; savingCents?: number };
type Recommendation = { source: "live"; store: Store; channel: "pickup"; demand: Item[]; baseline: Quote; candidates: Quote[]; best: Quote; withinBudget: boolean; budgetCents: number; verifiedAt: string; scope: string; warnings: string[] };
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const help: Record<string, string> = {
  PROFILE_REQUIRED: "服务端尚未配置经实际 tools/list 与返回数据核对的菜单映射。需先完成服务端适配配置，再验收真实账户流程。",
  TOKEN_REQUIRED: "服务端尚未配置账户令牌。请由运行者通过安全环境变量配置，不要把令牌输入网页或聊天。",
  SIGN_IN_REQUIRED: "当前访问未通过所有者校验，请由运行者检查本地或可信网关访问配置。",
  FORBIDDEN: "当前账户无权访问此服务，请确认所有者权限。",
  SCOPE_TOO_BROAD: "候选组合超过本流程的核价上限。请减少所选套餐或需求后重新计算。",
  TIMEOUT: "查询超时，尚未取得可用的官方价格。请稍后重试。",
  RATE_LIMITED: "官方服务限流，请稍后再试，不要连续重复请求。",
};

export default function LivePickup() {
  const [search, setSearch] = useState("");
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [demand, setDemand] = useState<Item[]>([]);
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [budget, setBudget] = useState("60");
  const [allowExtras, setAllowExtras] = useState(false);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { const controller = active.current; active.current = null; controller?.abort(); }, []);
  const totalUnits = demand.reduce((sum, item) => sum + item.quantity, 0);
  const budgetCents = Math.round(Number(budget) * 100);
  const validBudget = budget.trim() !== "" && Number.isSafeInteger(budgetCents) && budgetCents > 0 && budgetCents <= 999900;

  async function request<T>(action: string, payload: Record<string, unknown>): Promise<T | null> {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(action); setError(""); setResult(null);
    const timer = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }), signal: controller.signal });
      const data = await response.json() as { source?: string; error?: string | { code?: string; message?: string }; code?: string; message?: string };
      if (!data || typeof data !== "object") throw new Error("服务返回格式不正确，未产生官方推荐。");
      if (!response.ok) {
        const code = typeof data.error === "string" ? data.error : data.error?.code ?? data.code;
        throw new Error(help[code ?? ""] ?? data.message ?? (typeof data.error === "object" ? data.error?.message : undefined) ?? `查询失败（${response.status}），未产生官方推荐。`);
      }
      if (data.source !== "live") throw new Error("返回数据没有真实来源标记，已拒绝展示为官方结果。");
      return data as T;
    } catch (cause) {
      if (active.current === controller) setError(cause instanceof Error && cause.name === "AbortError" ? help.TIMEOUT : cause instanceof Error ? cause.message : "真实查询失败，请稍后重试。");
      return null;
    } finally {
      window.clearTimeout(timer);
      if (active.current === controller) { active.current = null; setBusy(null); }
    }
  }
  async function findStores() {
    if (!search.trim()) { setError("请输入门店关键词。"); return; }
    setStores([]); setStoreId(""); setCatalog(null); setDemand([]); setOfferIds([]);
    const data = await request<{ source: "live"; stores: Store[] }>("pickup-stores", { search: search.trim() });
    if (data) {
      if (!isLiveStores(data)) { setError("门店返回结构已变化，尚未加载真实门店。"); return; }
      setStores(data.stores);
      if (!data.stores.length) setError("未找到可用门店，请调整关键词。");
    }
  }
  async function loadCatalog(id: string) {
    setStoreId(id); setCatalog(null); setDemand([]); setOfferIds([]); setResult(null);
    if (!id) return;
    const data = await request<Catalog>("pickup-catalog", { storeId: id });
    if (data) {
      if (!isLiveCatalog(data, id)) { setError("菜单返回结构或门店不一致，未使用这批数据。"); return; }
      setCatalog({ ...data, store: stores.find((store) => store.id === id) ?? data.store });
      setOfferIds(data.offers.map((offer: { id: string }) => offer.id));
    }
  }
  function quantity(productId: string, value: number) {
    if (value < 0 || value > 12 || totalUnits - (demand.find((item) => item.productId === productId)?.quantity ?? 0) + value > 12) return;
    setDemand((previous) => [...previous.filter((item) => item.productId !== productId), ...(value ? [{ productId, quantity: value }] : [])]);
    setResult(null); setError("");
  }
  async function recommend() {
    if (!validBudget || !demand.length) { setError("请选择真实餐品，并填写大于 0 且不超过 9999 元的预算。"); return; }
    const data = await request<Recommendation>("pickup-recommend", { storeId, demand, budgetCents, allowExtras, offerIds });
    if (data) {
      if (!isLiveRecommendation(data, storeId, budgetCents, demand, allowExtras)) { setError("官方核价结果不完整，未显示推荐。"); return; }
      setResult({ ...data, store: catalog?.store ?? data.store });
    }
  }
  const itemLabel = (item: Item) => `${item.name ?? catalog?.products.find((product) => product.id === item.productId)?.name ?? "餐品"} ×${item.quantity}`;

  return <>
    <section className="page-heading"><span className="section-kicker">LIVE PICKUP · READ ONLY</span><h1>用真实菜单，<br /><span>核对这一餐。</span></h1><p>指定一家门店、到店自取，只比较已筛选的少量方案。每份价格由官方核价确认，不混用演示目录。</p><div className="page-heading-stamp"><ShoppingBag size={45} strokeWidth={1.3} /><span>到店自取 · 只读</span></div></section>
    <div className="demo-banner live-boundary"><ShieldCheck size={19} /><p><strong>真实流程与演示完全分开。</strong> 未配置令牌或实际数据映射时会明确停止；不会回退演示价格。此页数据仅保留于当前页面内存，不存入历史、不自动领取优惠或下单。</p></div>
    <section className="live-workflow planner-card" aria-label="真实到店自取流程">
      <div className="section-heading"><span className="step-number">01</span><h2>选定门店与渠道</h2></div>
      <form className="live-store-search" onSubmit={(event) => { event.preventDefault(); void findStores(); }}><label htmlFor="live-store-search">门店关键词</label><div><input id="live-store-search" value={search} disabled={!!busy} onChange={(event) => { setSearch(event.target.value); setStores([]); setStoreId(""); setCatalog(null); setDemand([]); setResult(null); }} placeholder="输入门店查询关键词" maxLength={100} /><button className="primary-small" disabled={!!busy || !search.trim()} type="submit">{busy === "pickup-stores" ? <Loader2 size={16} className="spin" /> : <Search size={16} />}查询门店</button></div></form>
      {stores.length > 0 && <div className="live-field"><label htmlFor="live-store-select">真实返回的门店</label><select id="live-store-select" disabled={!!busy} value={storeId} onChange={(event) => void loadCatalog(event.target.value)}><option value="">请选择一家门店</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div>}
      <p className="live-caption">搜索城市由运行者预先配置，渠道固定为到店自取。门店编码、餐品编码、金额单位与规则只取服务端核对过的实际数据。</p>
      {busy === "pickup-catalog" && <p role="status"><Loader2 className="spin" size={16} />正在读取当前门店菜单与适用优惠…</p>}
      {catalog && <>
        <div className="section-heading preference-heading"><span className="step-number">02</span><h2>确认真实需求与比较范围</h2></div>
        <div className="live-scope"><strong>{catalog.store.name} · 到店自取</strong><p>{catalog.scope}</p><p>本次限 {catalog.limits?.products ?? 8} 种餐品、{catalog.limits?.offers ?? 16} 个套餐选项、12 份餐品及最多 {catalog.limits?.candidates ?? 5} 个候选购物车；不是整店、全网最低价。</p></div>
        <div className="live-products">{catalog.products.map((product) => { const value = demand.find((item) => item.productId === product.id)?.quantity ?? 0; return <div key={product.id}><span>{product.name}</span><div className="quantity"><button disabled={!!busy || !value} aria-label={`减少真实餐品${product.name}`} onClick={() => quantity(product.id, value - 1)}><Minus size={15} /></button><span aria-live="polite">{value}</span><button disabled={!!busy || totalUnits >= 12} aria-label={`增加真实餐品${product.name}`} onClick={() => quantity(product.id, value + 1)}><Plus size={15} /></button></div></div>; })}</div>
        <p className="live-caption">已选 {totalUnits} / 12 份。列表展示不作为最终报价；基准和候选都要重新官方核价。</p>
        <fieldset className="live-offers" disabled={!!busy}><legend>参与比较的套餐选项</legend>{catalog.offers.length ? catalog.offers.map((offer) => <label key={offer.id}><input type="checkbox" checked={offerIds.includes(offer.id)} onChange={(event) => { setOfferIds((ids) => event.target.checked ? [...ids, offer.id] : ids.filter((id) => id !== offer.id)); setResult(null); }} /><span><strong>{offer.title}</strong><small>{offer.coverage.map(itemLabel).join("、")}</small></span></label>) : <p>当前筛选范围内无套餐选项，只核对单点基准。</p>}</fieldset>
        <details className="live-coupons"><summary>当前适用优惠信息（{catalog.coupons.length}）</summary><p>仅展示本次查询信息，不自动领券或猜测叠加规则；本流程未建模的券不参与核价组合。</p>{catalog.coupons.map((coupon, i) => <p key={i}>{coupon.title}</p>)}</details>
        <div className="live-preferences"><div className="live-field"><label htmlFor="live-budget">本次预算（元）</label><input id="live-budget" type="number" inputMode="decimal" min="0.01" max="9999" step="0.01" value={budget} disabled={!!busy} onChange={(event) => { setBudget(event.target.value); setResult(null); }} /></div><label className="live-extra"><input type="checkbox" checked={allowExtras} disabled={!!busy} onChange={(event) => { setAllowExtras(event.target.checked); setResult(null); }} />允许含额外餐品的候选，逐项说明</label></div>
        {catalog.warnings?.map((warning, i) => <p className="audit-warning" key={i}><Info size={14} />{warning}</p>)}
        <button className="calculate-button" disabled={!!busy || !demand.length || !validBudget} onClick={() => void recommend()}>{busy === "pickup-recommend" ? <Loader2 size={18} className="spin" /> : <ShieldCheck size={18} />}按同一需求进行官方核价<ArrowRight size={18} /></button>
      </>}
      {error && <div className="connection-error" role="alert"><Info size={17} /><span>{error} 没有产生新的官方推荐。</span></div>}
      {busy && <p className="live-caption" role="status">正在进行只读查询；完成前不会展示未核定的价格。</p>}
    </section>
    {result && <section className="live-results" aria-label="官方核价结果"><div className="secondary-heading"><div><span className="section-kicker">OFFICIAL PRICE COMPARISON</span><h2>本次已核价的方案</h2></div><span className="live-label"><span />真实核价 · 非演示</span></div><div className="live-scope"><strong>{result.store.name} · 到店自取</strong><p>原始需求：{result.demand.map(itemLabel).join("、")}</p><p>{result.scope}</p><p>核价时间：{new Date(result.verifiedAt).toLocaleString("zh-CN")}。不锁定库存或结算价格。</p></div><div className={`budget-status ${result.withinBudget ? "within" : "over"}`}><Info size={16} />{result.withinBudget ? `已核价的推荐在预算内，余 ${money(result.budgetCents - result.best.totalCents)}` : `当前范围内没有预算内方案；最低核价仍超出 ${money(result.best.totalCents - result.budgetCents)}。未擅自删减需求。`}</div><div className="live-quote-grid">{[result.baseline, ...result.candidates].map((quote, i) => <article className="live-quote" key={i}><span>{i === 0 ? "同需求单点基准" : `候选 ${i}`}</span><h3>{quote.title}</h3><strong className="live-price">{money(quote.totalCents)}</strong><p>{quote.items.map(itemLabel).join("、")}</p><p>{quote.extraItems.length ? `额外餐品：${quote.extraItems.map(itemLabel).join("、")}` : "无额外餐品"}</p>{i > 0 && <p>比基准{quote.totalCents <= result.baseline.totalCents ? "少付" : "多付"} {money(Math.abs(result.baseline.totalCents - quote.totalCents))}</p>}</article>)}</div><div className="just-right-note"><CheckCircle2 size={19} /><p>当前已核价集合内推荐：<strong>{result.best.title} · {money(result.best.totalCents)}</strong>。不是全局最低价。</p></div>{result.warnings?.map((warning, i) => <p className="audit-warning" key={i}>{warning}</p>)}</section>}
  </>;
}
