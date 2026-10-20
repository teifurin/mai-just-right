"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, ArrowUpRight, Bike, Cable, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Copy, Download, ExternalLink, History, Info, Leaf, Link2, Loader2, Minus, Plus, ReceiptText, RotateCcw, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Ticket, Trash2, Users, UtensilsCrossed, Wallet, X } from "lucide-react";
import { catalog, demoOffers, scenarios, planMeal, parseIntent, splitBill, makeReceipt, DEMO_NOW } from "../core/index.mjs";

type Tab = "planner" | "coupons" | "history" | "connection";
type Channel = "pickup" | "delivery";
type Product = { id: string; name: string; category: string; priceCents: number; tags?: string[] };
type Item = { productId: string; quantity: number };
type MealInput = { items: Item[]; budgetCents: number; people: number; allowExtras: boolean; channel: Channel; excludedTags?: string[]; now?: string };
type PlanItem = Item & { name: string; unitPriceCents: number; extraQuantity?: number };
type Offer = { id: string; title: string; type: string; priceCents: number; items: Item[]; maxUses?: number; channels: string[]; startsAt: string; expiresAt: string; requirements?: string[]; exclusiveGroup?: string; storeIds?: string[] };
type Plan = { id: string; title: string; totalCents: number; savingCents: number; extraCount: number; items: PlanItem[]; offers: { id: string; title: string; priceCents: number; uses?: number }[]; breakdown: { label: string; amountCents: number }[]; explanation: string | string[]; withinBudget: boolean; reason?: string };
type Share = { id: string; name: string; weight: number; amountCents: number };
type MealResult = { source: string; baselineCents: number; budgetCents: number; best: Plan; alternatives: Plan[]; notRecommended: Plan[]; stats: { offeredCount?: number; eligibleOfferCount?: number; visitedStates?: number }; warnings: string[]; split: Share[]; discardedOffers?: { id: string; title?: string; reasons?: string[]; reason?: string }[] };
type Scenario = MealInput & { id: string; title: string; description: string; prompt: string };
type Intent = Partial<MealInput> & { note?: string; recognized?: string[]; unknownText?: string | string[] };
type Decision = { id: string; savedAt: string; input: MealInput; result: MealResult };
type McpTool = { name: string; description?: string; inputSchema?: unknown; allowed?: boolean; readOnlyAllowed?: boolean };
type McpResponse = { message?: string; error?: string | { message?: string }; tools?: McpTool[]; result?: { tools?: McpTool[] }; data?: { tools?: McpTool[] } };
type McpStatus = { configured: boolean; mode: "live" | "demo"; endpoint?: string; liveVerified: boolean };

const products = catalog as unknown as Product[];
const offers = demoOffers as unknown as Offer[];
const examples = scenarios as unknown as Scenario[];
const calculate = planMeal as unknown as (input: MealInput) => MealResult;
const readIntent = parseIntent as unknown as (text: string) => Intent;
const receiptText = makeReceipt as unknown as (result: MealResult) => string;
const divide = splitBill as unknown as (total: number, participants: { id: string; name: string; weight: number }[]) => Share[];
const initial: MealInput = { ...examples[0], now: DEMO_NOW };
const money = (cents: number) => (cents / 100).toFixed(2);
const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;
const HISTORY_KEY = "mai-just-right.decisions.v1";
function loadDecisions(): Decision[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((value: unknown): value is Decision => {
      if (!value || typeof value !== "object") return false;
      const row = value as Partial<Decision>;
      return typeof row.id === "string" && typeof row.savedAt === "string" && row.result?.source === "demo" && Number.isFinite(row.result.best?.totalCents) && Array.isArray(row.result.best?.items) && Array.isArray(row.result.alternatives) && Array.isArray(row.input?.items) && Number.isInteger(row.input?.people) && (row.input?.people ?? 0) > 0 && (row.input?.people ?? 13) <= 12;
    }).slice(0, 30);
  } catch { return []; }
}
const nav = [
  { id: "planner" as Tab, label: "今天怎么点", icon: UtensilsCrossed },
  { id: "coupons" as Tab, label: "我的优惠券", icon: Ticket },
  { id: "history" as Tab, label: "决策记录", icon: History },
  { id: "connection" as Tab, label: "接入与说明", icon: Cable },
];

function FoodArt({ kind = "burger", className = "" }: { kind?: string; className?: string }) {
  if (kind === "fries") return <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M29 53 24 16h9l6 39M40 51l-2-43h10l3 45M52 54l3-39h10l-3 40M64 54l9-30 9 3-10 30" fill="#F4BE46" stroke="#D49B30" strokeWidth="2" strokeLinejoin="round"/><path d="m21 43 9 47h43l8-47c-17 12-39 13-60 0Z" fill="#D94432"/><path d="m31 59 5 22h4l-4-22M64 59l-3 22h4l5-24" fill="#F36D54"/><path d="M43 72c5 5 10 5 15 0" stroke="#FFEAC1" strokeWidth="3" strokeLinecap="round"/></svg>;
  if (kind === "cola" || kind === "americano") return <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="m59 11 5-7 11 1" stroke="#52665C" strokeWidth="5" strokeLinecap="round"/><path d="m58 12-4 29" stroke="#52665C" strokeWidth="5"/><path d="m25 29 7 60c11 5 24 5 35 0l8-60" fill={kind === "americano" ? "#A67A4B" : "#FBFCF8"} stroke="#D7D3C8" strokeWidth="2"/><path d="m28 52 3 21h39l3-21" fill={kind === "americano" ? "#F5EBD9" : "#D94432"}/><path d="m42 57 16 11M43 68l14-11" stroke={kind === "americano" ? "#A67A4B" : "#FFE5B0"} strokeWidth="3" strokeLinecap="round"/><ellipse cx="50" cy="29" rx="26" ry="6" fill="#EDEAE0" stroke="#BDBDB2" strokeWidth="2"/><path d="m54 28 2-12" stroke="#52665C" strokeWidth="5"/></svg>;
  if (kind === "nuggets") return <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="m14 49 11 38h53l10-38" fill="#F1E6C8" stroke="#D9CDAF" strokeWidth="2"/><path d="M29 56c-15-5-15-26-1-28 13-3 21 6 18 15-1 9-9 17-17 13Z" fill="#D7973C"/><path d="M50 43c-13-11-7-25 9-24 14 2 16 11 11 22-4 8-14 9-20 2Z" fill="#E4AD48"/><path d="M63 64c-15 1-22-16-10-24 12-8 29-3 28 9-1 10-9 14-18 15Z" fill="#D7973C"/><path d="M31 36h2m-7 8h2m32-16h2m6 18h2m-6 9h2" stroke="#FAD17C" strokeWidth="3" strokeLinecap="round"/><path d="M15 50c18 8 56 9 71 0l-8 37H25L15 50Z" fill="#F6EFD9"/><path d="M39 71h24" stroke="#D94432" strokeWidth="4" strokeLinecap="round"/></svg>;
  if (kind === "corn") return <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="m22 41 11 47h35l11-47" fill="#F6F2DF" stroke="#DDD6BA" strokeWidth="2"/><ellipse cx="50" cy="41" rx="29" ry="14" fill="#DBC776"/>{[[32,35],[45,29],[60,31],[69,40],[54,42],[39,42],[48,51]].map(([cx, cy],i)=><ellipse key={i} cx={cx} cy={cy} rx="7" ry="5" fill="#F7CC48" stroke="#DAB539" strokeWidth="1"/>)}<path d="M45 75c-5-9-7-12-5-18 11 0 14 7 5 18Z" fill="#668E5B"/><path d="M46 76c-1-12 5-15 13-15 0 10-5 13-13 15Z" fill="#3E7654"/></svg>;
  return <svg className={className} viewBox="0 0 120 100" fill="none" aria-hidden="true"><path d="M16 42C17 20 37 9 60 9s43 11 44 33H16Z" fill="#EFC36B" stroke="#D79C3D" strokeWidth="2"/><path d="m36 26 5-3m17-3 5 2m18 4 4 3m-31 5 4-1" stroke="#FFF0C3" strokeWidth="3" strokeLinecap="round"/><path d="M15 47c6-6 10 6 17 1 8-6 9 3 16 0 10-4 9 4 19-1 10-4 13 5 20 0 9-5 11 6 20 0" stroke="#668C44" strokeWidth="8" strokeLinecap="round"/><rect x="16" y="51" width="88" height="13" rx="6.5" fill="#814C31"/><path d="m18 60 27 12 20-9 34-3H18Z" fill="#F4C743"/><rect x="14" y="65" width="92" height="8" rx="4" fill="#D44A35"/><path d="M17 74h86c-1 13-11 17-43 17-30 0-41-5-43-17Z" fill="#E6B65D" stroke="#D79C3D" strokeWidth="2"/><path d="M26 81c18 4 52 4 68 0" stroke="#F6D794" strokeWidth="3" strokeLinecap="round"/></svg>;
}
function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M10 17c0-7 5-10 10-10s10 3 10 10H10Z" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round"/><path d="M9 22h22M10 27c3 5 17 5 20 0H10Z" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="m17 12 1-1m5 2 1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span>;
}
function SourceTag() { return <span className="source-tag"><span />演示数据</span>; }
function Quantity({ value, onChange, name }: { value: number; onChange: (value: number) => void; name: string }) {
  return <div className="quantity"><button type="button" disabled={!value} aria-label={`减少${name}`} onClick={() => onChange(Math.max(0, value - 1))}><Minus size={13} /></button><span aria-live="polite">{value}</span><button type="button" disabled={value >= 12} aria-label={`增加${name}`} onClick={() => onChange(Math.min(12, value + 1))}><Plus size={13} /></button></div>;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("planner");
  const [draft, setDraft] = useState<MealInput>(initial);
  const [result, setResult] = useState<MealResult>(() => calculate(initial));
  const [calculatedInput, setCalculatedInput] = useState<MealInput>(initial);
  const [intent, setIntent] = useState(examples[0].prompt);
  const [parseNote, setParseNote] = useState("");
  const [recognized, setRecognized] = useState<string[]>([]);
  const [category, setCategory] = useState("全部");
  const [history, setHistory] = useState<Decision[]>(loadDecisions);
  const historyReady = true;
  const [toast, setToast] = useState("");
  const [isPending, startTransition] = useTransition();
  const [couponFilter, setCouponFilter] = useState("全部优惠");
  const [couponSearch, setCouponSearch] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [shareWeights, setShareWeights] = useState<number[]>([]);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [connectionBusy, setConnectionBusy] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [liveTools, setLiveTools] = useState<McpTool[]>([]);
  const [selectedTool, setSelectedTool] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");
  const [compareArgs, setCompareArgs] = useState(JSON.stringify({ totalPath: [], unit: "yuan", baseline: { title: "原需求原价", arguments: {} }, candidates: [{ title: "候选方案", extraCount: 0, arguments: {} }] }, null, 2));
  const [connectionResult, setConnectionResult] = useState<unknown>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    fetch("/api/mcp/status").then((r) => r.ok ? r.json() : null).then((data) => { if (data) setStatus(data as McpStatus); }).catch(() => {});
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4500); return () => window.clearTimeout(timer); }, [toast]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(calculatedInput);
  const count = draft.items.reduce((n, item) => n + item.quantity, 0);
  const best = result.best;
  const delivery = calculatedInput.channel === "delivery";
  const declined = result.notRecommended?.[0];
  const alternativePlans = result.alternatives?.filter((p) => p.id !== best.id).slice(0, 2) ?? [];
  const shares = useMemo(() => divide(best.totalCents, Array.from({ length: calculatedInput.people }, (_, i) => ({ id: `person-${i}`, name: `第 ${i + 1} 位`, weight: shareWeights[i] || 1 }))), [best.totalCents, calculatedInput.people, shareWeights]);
  const filteredOffers = useMemo(() => offers.filter((offer) => {
    const match = `${offer.title} ${offer.requirements?.join(" ")} ${offer.items.map((i) => productName(i.productId)).join(" ")}`.toLowerCase().includes(couponSearch.toLowerCase());
    const remaining = new Date(offer.expiresAt).getTime() - new Date(DEMO_NOW).getTime();
    if (couponFilter === "即将到期") return match && remaining >= 0 && remaining <= 7 * 86400000;
    if (couponFilter === "到店自取") return match && offer.channels.includes("pickup");
    if (couponFilter === "外送可用") return match && offer.channels.includes("delivery");
    return match;
  }), [couponFilter, couponSearch]);

  function updateQuantity(productId: string, quantity: number) { setDraft((previous) => ({ ...previous, items: [...previous.items.filter((i) => i.productId !== productId), ...(quantity ? [{ productId, quantity }] : [])] })); }
  function setExample(scenario: Scenario) {
    setDraft({ items: scenario.items.map((i) => ({ ...i })), budgetCents: scenario.budgetCents, people: scenario.people, allowExtras: scenario.allowExtras, channel: scenario.channel, excludedTags: scenario.excludedTags ?? [], now: DEMO_NOW });
    setIntent(scenario.prompt); setRecognized([]); setParseNote(scenario.description);
  }
  function applyIntent() {
    if (!intent.trim()) { setParseNote("先写下想吃的商品、预算或人数吧。"); return; }
    try {
      const { note, recognized: terms, unknownText, ...values } = readIntent(intent);
      setDraft((previous) => ({ ...previous, ...values, now: DEMO_NOW })); setRecognized(terms ?? []);
      const unknown = Array.isArray(unknownText) ? unknownText.join("、") : unknownText;
      setParseNote([note, unknown ? `未识别部分：${unknown}。请在下方核对商品。` : "请在下方确认商品和数量，再开始计算。"].filter(Boolean).join(" "));
    } catch (error) { setParseNote(error instanceof Error ? error.message : "这句话还没读懂，请直接选择商品。"); }
  }
  function persistHistory(next: Decision[]) { setHistory(next); try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { setToast("方案已算好，但浏览器未允许保存本地记录。"); } }
  function runPlan() {
    if (!draft.items.length) { setToast("至少选一样真正想吃的，再开始计算。"); return; }
    if (!Number.isFinite(draft.budgetCents) || draft.budgetCents <= 0) { setToast("请填写大于 0 的预算。"); return; }
    startTransition(() => {
      try {
        const next = calculate(draft); setResult(next); setCalculatedInput({ ...draft, items: draft.items.map((i) => ({ ...i })) }); setShareWeights([]);
        persistHistory([{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, savedAt: new Date().toISOString(), input: draft, result: next }, ...history].slice(0, 30));
        setToast(draft.channel === "delivery" ? "餐品方案已算好，配送、打包等费用仍需实际核定。" : next.best.withinBudget ? "算好了，想吃的和餐品金额都核对好了。" : "已找到最低餐品金额，但仍超过预算。请查看提示。");
      } catch (error) { setToast(error instanceof Error ? error.message : "这次没算出来，请调整数量重试。"); }
    });
  }
  async function copyText(text: string, message = "已复制，可以发给一起吃饭的人。") { try { await navigator.clipboard.writeText(text); setToast(message); } catch { setToast("浏览器未允许剪贴板访问，请使用下载小票。"); } }
  function downloadReceipt() { const url = URL.createObjectURL(new Blob([receiptText({ ...result, split: shares })], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "麦麦刚刚好-点餐小票.txt"; a.click(); URL.revokeObjectURL(url); setToast("点餐小票已下载，内含商品、优惠和演示说明。"); }
  function tryOffer(offer: Offer) { setDraft((previous) => ({ ...previous, items: offer.items.map((i) => ({ ...i })), channel: offer.channels.includes(previous.channel) ? previous.channel : offer.channels[0] as Channel })); setIntent(offer.items.map((i) => `${i.quantity}份${productName(i.productId)}`).join("，")); setParseNote(`已带入「${offer.title}」的商品。先删去不想吃的，再看看是否划算。`); setTab("planner"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function callMcp(action: "discover" | "snapshot" | "call" | "compare") {
    setConnectionBusy(action); setConnectionError(""); setConnectionResult(null); setVerified(false);
    try {
      let args: unknown;
      if (action === "call" || action === "compare") {
        try { args = JSON.parse(action === "compare" ? compareArgs : toolArgs); } catch { throw new Error("参数不是有效的 JSON，请检查引号和逗号。"); }
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("参数必须是一个 JSON 对象。");
        if (action === "call" && !selectedTool) throw new Error("请先选择要检查的只读工具。");
      }
      const response = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(action === "call" ? { name: selectedTool, arguments: args } : action === "compare" ? { request: args } : {}) }) });
      const data = await response.json() as McpResponse;
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.message ?? data.error?.message ?? `连接失败（${response.status}）`);
      setConnectionResult(data); setVerified(true);
      if (action === "discover") { const list: McpTool[] = data.tools ?? data.result?.tools ?? data.data?.tools ?? []; setLiveTools(list); setSelectedTool(list.find((tool) => tool.allowed !== false)?.name ?? ""); setToast(`已从真实服务发现 ${list.length} 个工具。`); }
      else setToast("真实接口已返回，结果见下方。未执行领券或下单。");
      const fresh = await fetch("/api/mcp/status"); if (fresh.ok) setStatus(await fresh.json() as McpStatus);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "暂时无法连接，请稍后重试。"); }
    finally { setConnectionBusy(null); }
  }
  const chosenTool = liveTools.find((tool) => tool.name === selectedTool);

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setTab("planner")} aria-label="麦麦刚刚好，回到首页"><BrandMark /><span><strong>麦麦刚刚好<span className="brand-dot">.</span></strong><small>JUST ENOUGH. JUST RIGHT.</small></span></button>
      <div className="sidebar-label">你的点餐小帮手</div>
      <nav className="main-nav" aria-label="主要导航">{nav.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={tab === item.id ? "active" : ""} aria-label={item.label} aria-current={tab === item.id ? "page" : undefined}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.id === "coupons" && <small>{offers.length}</small>}{tab === item.id && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-note"><div className="tiny-flower" aria-hidden="true">✳</div><h3>每一口，<br />都刚好喜欢。</h3><p>优惠有很多。<br />真正想吃的，才值得点。</p><span className="note-line" /><small>A LITTLE LESS. A LITTLE BETTER.</small></div>
      <div className="sidebar-bottom"><span className="status-dot" /><span>开发者挑战赛 · 独立参赛作品</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>麦麦刚刚好</span><ChevronRight size={13} /><strong>{nav.find((n) => n.id === tab)?.label}</strong></div><div className="topbar-actions"><SourceTag /><button className="connect-button" onClick={() => setTab("connection")}><Link2 size={15} /><span>{verified ? "真实接口已验证" : status?.configured ? "查看已配置接口" : "连接我的麦当劳"}</span><ArrowUpRight size={13} /></button></div></header>
      <main className="main-content" id="main-content">
        {tab === "planner" && <>
          <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="little-spark">✳</span> GOOD FOOD. SMART CHOICES.</div><h1>吃你想吃的，<br /><span>省真正的钱。</span></h1><p>先选想吃的，再让优惠来配合你。<br />不为凑单多买一点，不为折扣多花一分。</p><div className="hero-proof"><ShieldCheck size={15} /><span>同样的食物，比一比最后付多少</span></div></div><div className="hero-art" aria-hidden="true"><span className="art-orbit" /><div className="art-burger"><FoodArt /></div><div className="art-fries"><FoodArt kind="fries" /></div><div className="hero-sticker"><span>刚刚好</span><small>THAT’S THE POINT.</small></div><div className="mini-receipt"><div className="mini-receipt-heading"><BrandMark small /><span>JUST RIGHT<br /><small>今天也要好好吃饭</small></span></div><div className="mini-dashed" /><div className="mini-line"><span>想吃的</span><span>一份不落 ✓</span></div><div className="mini-line"><span>不想吃的</span><span>不用加 ✓</span></div><div className="mini-dashed" /><div className="mini-total"><small>本次演示餐品金额</small><strong><span>¥</span>{money(best.totalCents)}</strong></div><div className="mini-receipt-foot">LESS WASTE. MORE TASTE.</div><div className="receipt-barcode" /></div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span></div></section>
          <div className="planner-intro"><div><span className="section-kicker">YOUR NEXT MEAL</span><h2>把这一餐，点得刚刚好。<span className="hand-line" /></h2></div><span className="data-date"><span />演示优惠数据 · 2026.10.17</span></div>
          <div className="planner-grid">
            <section className="planner-card" aria-label="点餐需求">
              <div className="section-heading"><span className="step-number">01</span><h3>今天想吃什么？</h3><span className="small-note">说一句，或者直接选</span></div>
              <div className="intent-box"><Sparkles size={18} className="intent-icon" /><label className="sr-only" htmlFor="meal-intent">用一句话描述点餐需求</label><textarea id="meal-intent" rows={2} value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="比如：两个人吃，要两个汉堡和一份薯条，预算 60 元…" maxLength={500} /><button onClick={applyIntent} className="intent-action" aria-label="识别点餐需求"><ArrowRight size={19} /></button></div>
              <div className="intent-foot"><span>本地规则识别 · 无需上传对话</span><button onClick={applyIntent}>识别这句话 <ArrowUpRight size={12} /></button></div>
              {parseNote && <p className="parse-note" role="status"><Info size={14} />{parseNote}</p>}{recognized.length > 0 && <div className="recognized">{recognized.slice(0, 8).map((term, i) => <span key={`${term}-${i}`}><Check size={10} />{term}</span>)}</div>}
              <div className="scenario-row"><span>试试</span>{examples.slice(0, 3).map((scenario, i) => <button key={scenario.id} onClick={() => setExample(scenario)}><span>{["☀", "↗", "♡"][i]}</span>{scenario.title}<ChevronRight size={12} /></button>)}</div>
              <div className="product-toolbar"><div className="category-tabs" aria-label="商品分类">{["全部", "汉堡", "小食", "饮品"].map((value) => <button key={value} className={category === value ? "active" : ""} onClick={() => setCategory(value)} aria-pressed={category === value}>{value}</button>)}</div><button className="text-button clear-items" onClick={() => setDraft((previous) => ({ ...previous, items: [] }))} disabled={!count}>清空已选</button></div>
              <div className="product-grid">{products.filter((p) => category === "全部" || p.category === category).map((product) => { const quantity = draft.items.find((i) => i.productId === product.id)?.quantity ?? 0; return <article className={`product-card ${quantity ? "selected" : ""}`} key={product.id}><div className="product-art"><FoodArt kind={product.id} />{quantity > 0 && <span className="product-check"><Check size={10} /></span>}</div><h4>{product.name}</h4><div className="product-bottom"><span className="product-price"><small>¥</small>{(product.priceCents / 100).toFixed(1)}</span><Quantity name={product.name} value={quantity} onChange={(n) => updateQuantity(product.id, n)} /></div></article>; })}</div>
              <div className="product-caption"><Info size={12} />商品与价格为合成演示数据，不代表门店报价。<span>已选 <strong>{count}</strong> 份</span></div>
              {!!draft.excludedTags?.length && <div className="excluded-tags"><span>当前限制：{draft.excludedTags.join("、")}</span><button onClick={() => setDraft((previous) => ({ ...previous, excludedTags: [] }))}>清除限制 <X size={12} /></button></div>}
              <div className="section-heading preference-heading"><span className="step-number">02</span><h3>再加一点小偏好</h3><SlidersHorizontal size={15} className="muted-icon" /></div>
              <div className="preferences"><div className="preference-field"><label htmlFor="budget"><Wallet size={14} />总预算</label><div className="budget-input"><span>¥</span><input id="budget" type="number" min="1" max="9999" step="0.5" inputMode="decimal" value={Number.isFinite(draft.budgetCents) ? draft.budgetCents / 100 : ""} onChange={(e) => setDraft((previous) => ({ ...previous, budgetCents: e.target.value === "" ? 0 : Math.round(Number(e.target.value) * 100) }))} /><span>元</span></div></div><div className="preference-field"><label><Users size={14} />用餐人数</label><div className="people-input"><button aria-label="减少用餐人数" disabled={draft.people <= 1} onClick={() => setDraft((previous) => ({ ...previous, people: previous.people - 1 }))}><Minus size={14} /></button><span>{draft.people}<small> 人</small></span><button aria-label="增加用餐人数" disabled={draft.people >= 12} onClick={() => setDraft((previous) => ({ ...previous, people: previous.people + 1 }))}><Plus size={14} /></button></div></div><div className="preference-field channel-field"><label><ShoppingBag size={14} />用餐方式</label><div className="channel-toggle"><button className={draft.channel === "pickup" ? "active" : ""} onClick={() => setDraft((previous) => ({ ...previous, channel: "pickup" }))} aria-pressed={draft.channel === "pickup"}><ShoppingBag size={13} />自取</button><button className={draft.channel === "delivery" ? "active" : ""} onClick={() => setDraft((previous) => ({ ...previous, channel: "delivery" }))} aria-pressed={draft.channel === "delivery"}><Bike size={13} />外送</button></div></div></div>
              <div className="extras-setting"><div><strong>真的更便宜，才考虑额外餐品</strong><p>{draft.allowExtras ? "允许比较多含商品的组合；仍按餐品金额排序。" : "关掉时严格按已选数量，绝不为了用券加餐。"}</p></div><button type="button" role="switch" aria-checked={draft.allowExtras} aria-label="允许更便宜的额外商品组合" className={`switch ${draft.allowExtras ? "on" : ""}`} onClick={() => setDraft((previous) => ({ ...previous, allowExtras: !previous.allowExtras }))}><span /></button></div>
              <button className="calculate-button" onClick={runPlan} disabled={isPending || !count}>{isPending ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}<span>{isPending ? "正在核对优惠规则…" : "算一份刚刚好的方案"}</span><span className="calculate-arrow"><ArrowRight size={19} /></span></button><div className="calculator-foot"><ShieldCheck size={12} />只比较方案，不自动领券、不下单、不付款。</div>
            </section>
            <aside className="results-column" aria-label="计算结果">
              {dirty && <div className="dirty-notice" role="status"><RotateCcw size={13} />需求已调整，重新计算后更新小票</div>}
              <section className="result-card"><div className="receipt-top"><span className="receipt-title">你的刚刚好方案</span><span className="recommend-tag"><Check size={11} />优先推荐</span></div><div className="receipt-subtitle"><span>JUST RIGHT, JUST FOR YOU.</span><SourceTag /></div><div className="receipt-amount"><span className="currency">¥</span><strong>{money(best.totalCents).split(".")[0]}</strong><span className="decimals">.{money(best.totalCents).split(".")[1]}</span><span className="receipt-unit">餐品金额</span></div><div className="saving-row"><span>按原价单点 <s>¥{money(result.baselineCents)}</s></span><span className="savings">↓ 省 ¥{money(Math.max(0, best.savingCents))}</span></div>
                <div className={`budget-status ${best.withinBudget ? "within" : "over"}`}>{best.withinBudget ? <CheckCircle2 size={14} /> : <Info size={14} />}<span>{best.withinBudget ? delivery ? "餐品金额预算内 · 配送等费用待核定" : `在预算内，还留有 ¥${money(result.budgetCents - best.totalCents)}` : `餐品超出预算 ¥${money(best.totalCents - result.budgetCents)}`}</span></div>
                {delivery && <p className="delivery-note">未含配送、打包或平台费，不代表最终应付。</p>}
                <div className="receipt-divider"><span /><span /></div><div className="receipt-items">{best.items.map((item, i) => <div className="receipt-item" key={`${item.productId}-${i}`}><span>{item.name}{(item.extraQuantity ?? 0) > 0 && <em>含额外 {item.extraQuantity} 份</em>}</span><span>× {item.quantity}</span></div>)}</div>
                <div className="applied-offers"><div><Ticket size={14} /><strong>{best.offers.length ? `用上 ${best.offers.length} 项优惠` : "单点更合适"}</strong></div>{best.offers.length ? best.offers.map((offer, i) => <p key={`${offer.id}-${i}`}><span>{offer.title}{(offer.uses ?? 1) > 1 ? ` × ${offer.uses}` : ""}</span><Check size={12} /></p>) : <p>无需凑单，也不强行使用优惠。</p>}</div>
                {!!best.breakdown?.length && <details className="price-details"><summary>看看钱怎么算 <ChevronDown size={13} /></summary><div>{best.breakdown.map((line, i) => <p key={i}><span>{line.label}</span><span>{line.amountCents < 0 ? "−" : ""}¥{money(Math.abs(line.amountCents))}</span></p>)}</div></details>}
                <div className="just-right-note"><Leaf size={15} /><p>{best.extraCount === 0 ? <>刚刚好的 <strong>{best.items.reduce((n, i) => n + i.quantity, 0)} 份</strong>，没有额外凑单。</> : <>比已选需求多 <strong>{best.extraCount} 份</strong>；你已允许额外商品。</>}</p></div><div className="receipt-actions"><button onClick={() => copyText(receiptText({ ...result, split: shares }))}><Copy size={14} />复制方案</button><button onClick={downloadReceipt} aria-label="下载点餐小票"><Download size={15} /></button></div>
              </section>
              {declined && <section className="declined-card"><div className="declined-icon"><X size={17} /></div><div><span className="section-kicker">A LITTLE CHECK FOR YOU</span><h3>这份“优惠”，没必要。</h3><p>{declined.title}</p><div className="declined-comparison"><span>餐品 ¥{money(declined.totalCents)}</span><span>{declined.totalCents >= best.totalCents ? `多花 ¥${money(declined.totalCents - best.totalCents)}` : `少花 ¥${money(best.totalCents - declined.totalCents)}`}</span></div><p className="declined-reason">{declined.reason || `需要额外买 ${declined.extraCount} 份。折扣看着更大，不代表你付得更少。`}</p><div className="declined-foot">优惠金额 ≠ 真正省下的钱</div></div></section>}
              <details className="audit-card"><summary><ShieldCheck size={15} /><span>为什么推荐这个方案？</span><ChevronDown size={14} /></summary><div className="audit-body"><p>{Array.isArray(best.explanation) ? best.explanation.join(" ") : best.explanation}</p><dl><div><dt>商品需求</dt><dd>{calculatedInput.allowExtras ? "允许更便宜的额外组合" : "数量严格匹配"}</dd></div><div><dt>可用优惠</dt><dd>{result.stats.eligibleOfferCount ?? "—"} / {result.stats.offeredCount ?? offers.length} 项</dd></div><div><dt>枚举状态</dt><dd>{result.stats.visitedStates?.toLocaleString() ?? "—"}</dd></div><div><dt>比较依据</dt><dd>餐品金额（分）</dd></div><div><dt>数据时间</dt><dd>2026.10.17 · 演示</dd></div></dl>{result.warnings?.map((warning, i) => <p className="audit-warning" key={i}><Info size={12} />{warning}</p>)}{!!result.discardedOffers?.length && <details className="discarded-details"><summary>未参与的 {result.discardedOffers.length} 项优惠</summary>{result.discardedOffers.map((offer) => <p key={offer.id}><strong>{offer.title ?? offer.id}</strong><br />{offer.reason ?? offer.reasons?.join("；") ?? "当前条件不适用"}</p>)}</details>}<p className="audit-note">结论仅覆盖演示目录与已建模规则，不代表全部真实门店优惠。</p></div></details>
            </aside>
          </div>
          {alternativePlans.length > 0 && <section className="alternatives-section"><div className="secondary-heading"><div><span className="section-kicker">A CLEARER CHOICE</span><h2>其他方案，也摆在桌面上。</h2></div><span>同一份需求，公开比较</span></div><div className="alternative-grid">{alternativePlans.map((plan, index) => <article className="alternative-card" key={plan.id}><span className="alternative-number">0{index + 2}</span><div><h3>{plan.title}</h3><p>{plan.items.map((item) => `${item.name} ×${item.quantity}`).join(" · ")}</p><span className={plan.extraCount ? "extra-label" : "exact-label"}>{plan.extraCount ? `多 ${plan.extraCount} 份食物` : "商品数量刚刚好"}</span></div><div className="alternative-price"><strong><small>¥</small>{money(plan.totalCents)}</strong><span>{plan.totalCents > best.totalCents ? `餐品多 ¥${money(plan.totalCents - best.totalCents)}` : plan.totalCents === best.totalCents ? "餐品金额相同" : `餐品少 ¥${money(best.totalCents - plan.totalCents)}`}</span></div></article>)}</div></section>}
          {calculatedInput.people > 1 && <section className="split-section"><div><span className="section-kicker">SHARE A MEAL</span><h2>一起吃，账也分清楚。</h2><p>默认平分餐品金额；可按份额调整。尾差按分分配，合计始终一致。{delivery && "配送等费用未计入。"}</p></div><div className="split-people">{shares.map((share, i) => <div key={share.id}><span className="person-avatar">{i + 1}</span><span>{share.name}</span><label><input type="number" min="1" max="1000" value={shareWeights[i] || 1} aria-label={`${share.name}的分摊份额`} onChange={(e) => { const value = Math.min(1000, Math.max(1, Math.round(Number(e.target.value) || 1))); setShareWeights((previous) => Array.from({ length: calculatedInput.people }, (_, j) => j === i ? value : previous[j] || 1)); }} />份</label><strong>¥{money(share.amountCents)}</strong></div>)}</div></section>}
        </>}

        {tab === "coupons" && <>
          <section className="page-heading"><span className="section-kicker">KNOW YOUR COUPONS</span><h1>优惠券多，<br /><span>也要用得刚刚好。</span></h1><p>先看适用条件，再比餐品金额。这里的每一张，都可以展开核对。</p><div className="page-heading-stamp"><Ticket size={45} strokeWidth={1.3} /><span>{offers.length} 张演示优惠</span></div></section>
          <div className="demo-banner"><Info size={17} /><p><strong>这是一组完整的合成优惠数据。</strong> 参考日期为 2026 年 10 月 17 日，并非你的账户券包；真实账户查询请前往接入页。</p><button onClick={() => setTab("connection")}>查看真实接入 <ArrowUpRight size={14} /></button></div>
          <div className="coupon-toolbar"><div className="filter-tabs" aria-label="优惠券筛选">{["全部优惠", "即将到期", "到店自取", "外送可用"].map((filter) => <button className={couponFilter === filter ? "active" : ""} onClick={() => setCouponFilter(filter)} key={filter}>{filter}{filter === "全部优惠" && <span>{offers.length}</span>}</button>)}</div><div className="coupon-search"><Search size={16} /><input aria-label="搜索优惠券或商品" placeholder="搜索优惠券、商品…" value={couponSearch} onChange={(e) => setCouponSearch(e.target.value)} /></div></div>
          <div className="coupon-grid">{filteredOffers.map((offer) => { const expired = new Date(offer.expiresAt).getTime() < new Date(DEMO_NOW).getTime(); const future = new Date(offer.startsAt).getTime() > new Date(DEMO_NOW).getTime(); return <article key={offer.id} className={`coupon-card ${expired ? "expired" : ""}`}><div className="coupon-card-top"><span>{offer.type === "bundle" ? "组合优惠" : "优惠券"}</span><span>{expired ? "已过期" : future ? "未开始" : "演示可用"}</span></div><div className="coupon-main"><div className="coupon-value"><span>¥</span><strong>{money(offer.priceCents).replace(/\.00$/, "")}</strong><small>{offer.type === "bundle" ? "组合价" : "优惠价"}</small></div><div><h3>{offer.title}</h3><p>{offer.items.map((item) => `${productName(item.productId)} ×${item.quantity}`).join(" + ")}</p></div></div><div className="coupon-tags">{offer.channels.map((channel) => <span key={channel}>{channel === "pickup" ? <ShoppingBag size={11} /> : <Bike size={11} />}{channel === "pickup" ? "到店自取" : "外送"}</span>)}{offer.maxUses && <span>每单限用 {offer.maxUses} 次</span>}</div><details className="coupon-rules"><summary>适用条件与有效期 <ChevronDown size={13} /></summary><div><p>{offer.requirements?.join("；") || "仅限券内指定商品与数量，不能替换商品。"}</p><p>有效期：{offer.startsAt.slice(0, 10)} — {offer.expiresAt.slice(0, 10)}</p>{offer.exclusiveGroup && <p>同组互斥：{offer.exclusiveGroup}</p>}{offer.storeIds && <p>适用门店：{offer.storeIds.join("、")}</p>}</div></details><div className="coupon-bottom"><span><Clock3 size={12} />{offer.expiresAt.slice(0, 10)} 到期</span><button disabled={expired || future} onClick={() => tryOffer(offer)}>带入商品试算 <ArrowRight size={13} /></button></div></article>; })}</div>
          {!filteredOffers.length && <div className="empty-state"><Search size={38} /><h2>没有找到符合条件的优惠</h2><p>换个关键词，或看看全部演示优惠。</p><button className="primary-small" onClick={() => { setCouponFilter("全部优惠"); setCouponSearch(""); }}>查看全部</button></div>}
        </>}

        {tab === "history" && <>
          <section className="page-heading"><span className="section-kicker">YOUR GOOD DECISIONS</span><h1>好好吃过的每一餐，<br /><span>都有据可查。</span></h1><p>计算后自动保存到当前浏览器。喜欢的搭配，下次接着用。</p><div className="page-heading-stamp"><ReceiptText size={45} strokeWidth={1.3} /><span>{history.length} 份点餐记录</span></div></section>
          <div className="history-toolbar"><div><ShieldCheck size={15} /><span>仅保存在当前设备 · 不含账户或令牌</span></div>{!!history.length && <button className="text-button danger" onClick={() => { if (clearConfirm) { persistHistory([]); setClearConfirm(false); setToast("本机点餐记录已清空。"); } else setClearConfirm(true); }}><Trash2 size={14} />{clearConfirm ? "确认清空全部记录" : "清空记录"}</button>}</div>
          {history.length ? <div className="history-list">{history.map((decision) => <article className="history-card" key={decision.id}><div className="history-art"><FoodArt kind={decision.input.items[0]?.productId} /></div><div className="history-info"><div><span>{new Date(decision.savedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><SourceTag /></div><h3>{decision.input.items.map((item) => `${productName(item.productId)} ×${item.quantity}`).join("、")}</h3><p>{decision.input.people} 人 · {decision.input.channel === "pickup" ? "到店自取" : "外送（未计配送费）"} · 预算 ¥{money(decision.input.budgetCents)} · {decision.input.allowExtras ? "允许额外组合" : "不凑单"}</p></div><div className="history-price"><strong>¥{money(decision.result.best.totalCents)}</strong><span>餐品省 ¥{money(Math.max(0, decision.result.best.savingCents))}</span></div><button className="restore-button" onClick={() => { setDraft(decision.input); setResult(decision.result); setCalculatedInput(decision.input); setIntent(decision.input.items.map((i) => `${i.quantity}份${productName(i.productId)}`).join("，")); setParseNote("已恢复这次需求与演示结果，可修改后重新计算。"); setRecognized([]); setShareWeights([]); setTab("planner"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>再吃一次 <ArrowUpRight size={14} /></button><button className="delete-record" aria-label="删除这条点餐记录" onClick={() => persistHistory(history.filter((item) => item.id !== decision.id))}><X size={15} /></button></article>)}</div> : <div className="empty-state"><div className="empty-receipt"><ReceiptText size={48} strokeWidth={1.3} /></div><h2>{historyReady ? "第一份刚刚好，等你来点。" : "正在读取本地记录…"}</h2><p>完成一次方案计算，这里就会留下你的点餐小票。</p><button className="primary-small" onClick={() => setTab("planner")}>去点今天这一餐 <ArrowRight size={15} /></button></div>}
        </>}

        {tab === "connection" && <>
          <section className="page-heading"><span className="section-kicker">OPEN BY DESIGN</span><h1>每一份推荐，<br /><span>都有清楚的来处。</span></h1><p>演示模式可以完整体验决策。接上真实服务后，可以检查工具与真实数据。</p><div className="page-heading-stamp"><Cable size={45} strokeWidth={1.3} /><span>McDonald’s MCP</span></div></section>
          <div className="connection-grid"><section className="connection-card"><div className="card-topline"><span className="icon-tile"><Link2 size={22} /></span><span className={`connection-state ${verified ? "verified" : ""}`}><span />{verified ? "真实接口已返回" : status?.configured ? "服务端已配置 · 待验证" : "未配置 · 演示模式"}</span></div><h2>连接真实 MCP 服务</h2><p>令牌由服务端环境变量 <code>MCD_MCP_TOKEN</code> 提供，网页不会索取或保存账户凭证。</p><ol className="connection-steps"><li><span>1</span><div><strong>获取并配置服务端令牌</strong><p>按大赛官方接入说明配置环境变量，再重启服务。</p></div></li><li><span>2</span><div><strong>发现工具，验证真实连接</strong><p>只展示接口实际返回的工具和输入结构。</p></div></li><li><span>3</span><div><strong>查询数据并核对结果</strong><p>真实结果独立展示，当前点餐计算仍使用演示目录。</p></div></li></ol><div className="connection-actions"><button className="primary-small" disabled={!!connectionBusy} onClick={() => callMcp("discover")}>{connectionBusy === "discover" ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}发现真实工具</button><button className="secondary-small" disabled={!!connectionBusy} onClick={() => callMcp("snapshot")}>{connectionBusy === "snapshot" ? <Loader2 size={15} className="spin" /> : <ReceiptText size={15} />}查询只读快照</button></div>{connectionError && <div className="connection-error" role="alert"><Info size={16} /><span>{connectionError}</span></div>}<a href="https://github.com/M-China/mcd-developer-innovation-challenge" target="_blank" rel="noreferrer" className="official-link">大赛官方接入文档 <ExternalLink size={13} /></a></section><section className="principles-card"><span className="section-kicker">A FEW THINGS WE BELIEVE</span><h2>做个有分寸的<br />点餐小帮手。</h2><div><span>01</span><p><strong>真正省钱，看最后支付多少</strong>对照同一份想吃的商品，不把增加购买量伪装成省钱。</p></div><div><span>02</span><p><strong>算得出，也说得清</strong>商品覆盖、渠道、有效期、互斥条件，都进入可检查的计算。</p></div><div><span>03</span><p><strong>选择权，始终交还给你</strong>这个项目只查询与比较。领券、下单和支付需要你自行决定。</p></div><div className="principles-foot"><ShieldCheck size={17} />独立参赛原型 · 非麦当劳官方产品</div></section></div>
          {liveTools.length > 0 && <section className="tool-inspector"><div className="secondary-heading"><div><span className="section-kicker">LIVE TOOL INSPECTOR</span><h2>真实工具检查</h2></div><span className="live-label"><span />服务端返回 · 非演示</span></div><p>工具调用受服务端只读白名单限制；可能修改账户、领券或产生订单的操作不会执行。</p><div className="tool-form"><div><label htmlFor="tool-select">选择工具</label><select id="tool-select" value={selectedTool} onChange={(e) => { setSelectedTool(e.target.value); setToolArgs("{}"); }}>{liveTools.map((tool) => <option key={tool.name} value={tool.name} disabled={tool.allowed === false}>{tool.name}{tool.allowed === false ? "（未在只读白名单）" : ""}</option>)}</select><p className="tool-description">{chosenTool?.description}</p><details className="schema-details"><summary>查看真实输入结构 <ChevronDown size={14} /></summary><pre>{JSON.stringify(chosenTool?.inputSchema ?? {}, null, 2)}</pre></details></div><div><label htmlFor="tool-args">查询参数（JSON）</label><textarea id="tool-args" rows={7} spellCheck={false} value={toolArgs} onChange={(e) => setToolArgs(e.target.value)} /><button className="primary-small" disabled={!!connectionBusy || !selectedTool} onClick={() => callMcp("call")}>{connectionBusy === "call" ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}执行只读查询</button></div></div></section>}
          <details className="advanced-compare"><summary><ReceiptText size={16} /><span>进阶：比较真实官方核价</span><ChevronDown size={15} /></summary><div><p>先发现真实工具并核对输入结构，再填入原需求与候选购物车参数。金额路径必须来自真实返回；空模板不能直接核价。服务端逐一调用官方核价工具，不使用演示价格。</p><label htmlFor="compare-args">核价对比请求（JSON）</label><textarea id="compare-args" rows={12} value={compareArgs} spellCheck={false} onChange={(e) => setCompareArgs(e.target.value)} /><button className="primary-small" disabled={!!connectionBusy} onClick={() => callMcp("compare")}>{connectionBusy === "compare" ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}比较真实餐品核价</button></div></details>
          {connectionResult !== null && <section className="raw-result"><div><h3><CheckCircle2 size={17} />真实接口返回</h3><button className="text-button" onClick={() => copyText(JSON.stringify(connectionResult, null, 2), "已复制真实接口结果。")}>复制结果 <Copy size={13} /></button></div><p>以下内容来自实际请求，未混入演示数据；请核对门店、费用范围与有效期。</p><pre tabIndex={0}>{JSON.stringify(connectionResult, null, 2)}</pre></section>}
          <section className="faq-section"><h2>你可能想确认的事</h2>{[
            ["这里的价格是真实的吗？", "点餐与优惠券页面使用合成演示数据，参考时间固定为 2026 年 10 月 17 日。它们不是实时门店价格，也不是你的账户券。真实 MCP 数据在接入页独立展示，尚未自动转换进优化器；进阶对比可按实际工具结构调用官方核价。"],
            ["为什么不用折扣最大的一张？", "优惠金额大，可能只是因为买了更多。我们先锁定你想吃的商品与数量，再比较餐品金额。默认不增加商品；主动开启额外组合后，才会考虑多含食物的方案，并清楚标注。"],
            ["输入一句话，是大模型在理解吗？", "此版本使用本地确定性规则识别商品、数量、预算、人数与渠道，无需外部模型。复杂表达或未识别部分会提示核对，你可随时直接调整商品。"],
            ["我的点餐记录存在哪里？", "仅保存在当前浏览器的本地存储里，最多 30 条，可逐条删除或清空。换设备、清除浏览器数据或使用无痕模式时，记录可能不会保留。"],
          ].map(([question, answer]) => <details key={question}><summary>{question}<Plus size={16} /></summary><p>{answer}</p></details>)}</section>
        </>}
        <footer className="footer"><div><BrandMark small /><span>让优惠配合生活。<strong>刚刚好，就很好。</strong></span></div><span>独立参赛作品 · 合成数据演示 · 不提供下单服务<a className="source-download" href="https://github.com/teifurin/mai-just-right" target="_blank" rel="noreferrer"><ExternalLink size={11} />查看完整开源项目</a></span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17} /><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast("")}><X size={14} /></button></div>}
  </div>;
}
