/* AShareSim 原型 · 核心：规则 / 费用 / 行情模拟 / 撮合 / 清算
 * 对应 docs/TRADING_RULES.md。原型里的实现是简化版，真实 App 用 TypeScript 重写并加单元测试。
 */
'use strict';

// ---------- 小工具 ----------
const r2 = v => Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100;
const roundTo = (v, tick) => +(Math.round(v / tick + 1e-9) * tick).toFixed(tick < 0.01 ? 3 : 2);
const fx = (v, d) => (v == null || isNaN(v)) ? '--' : Number(v).toFixed(d);
const money = v => (v == null || isNaN(v)) ? '--' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = v => Number(v).toLocaleString('zh-CN');
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function noise(seed) { return rng(seed)(); }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const hms = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
const T = (h, m, s = 0) => h * 3600 + m * 60 + s;

// ---------- 交易日历 ----------
const TODAY_REAL = '2026-10-26';
const CAL = (() => {
  const past = DATA.kline.sh000300.map(r => r[0]);
  const out = past.slice();
  let d = new Date(past[past.length - 1] + 'T00:00:00');
  while (out.length < past.length + 60) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (s === '2027-01-01') continue; // 元旦休市（示例）
    out.push(s);
  }
  return out;
})();
const dayIdx = s => CAL.indexOf(s);

// ---------- 证券基础信息 ----------
const SEC = {};
for (const [code, q] of Object.entries(DATA.quotes)) {
  const isIndex = code.startsWith('sh000') || code.startsWith('sz399');
  let board = 'main';
  if (isIndex) board = 'index';
  else if (q.type === 'ETF') board = 'etf';
  else if (q.type === 'GP-A-KCB') board = 'kcb';
  else if (q.type === 'GP-A-CYB') board = 'cyb';
  const st = /ST/.test(q.name);
  const name = q.name.replace('华泰柏瑞', '').replace('易方达', '').replace('南方', '').replace('华夏', '');
  SEC[code] = {
    code, sym: q.code, name, fullName: q.name, ex: code.slice(0, 2).toUpperCase(), board, st,
    tick: board === 'etf' ? 0.001 : 0.01, dec: board === 'etf' ? 3 : 2,
    limitPct: board === 'index' ? null : (board === 'kcb' || board === 'cyb') ? 0.2 : 0.1,
    unit: 100, minBuy: board === 'kcb' ? 200 : 100,
    maxLimit: board === 'kcb' ? 100000 : board === 'cyb' ? 300000 : 1000000,
    py: ''
  };
}
const BOARD_NAME = { main: '主板', cyb: '创业板', kcb: '科创板', etf: 'ETF', index: '指数' };
const PINYIN = { sh600519: 'gzmt', sz000001: 'payh', sz300750: 'ndsd', sh688981: 'zxgj', sh510300: 'hs300etf', sh601318: 'zgpa', sh600036: 'zsyh', sz000858: 'wly', sz002594: 'byd', sh601899: 'zjky', sz159915: 'cybetf', sh512100: 'zz1000etf', sh588000: 'kc50etf', sh600900: 'cjdl', sz000333: 'mdjt', sh601012: 'ljln', sz300059: 'dfcf', sz300033: 'ths', sh688111: 'jsbg', sz002415: 'hkws', sh601127: 'sls', sh600030: 'zxzq', sz000002: 'wka', sz000725: 'jdfa', sh601988: 'zgyh', sz002230: 'kdxf', sh603259: 'ymkd', sz300308: 'zjxc', sz002024: 'styg', sh600180: 'strm' };
for (const k in PINYIN) if (SEC[k]) SEC[k].py = PINYIN[k];
// 涨跌幅比例以行情接口给出的涨跌停价反推（例如跟踪创业板、科创板指数的 ETF 是 ±20%，不是 ±10%）
for (const [code, q] of Object.entries(DATA.quotes)) { const s = SEC[code]; if (s.limitPct && q.up > 0 && q.prev > 0) { const pct = Math.round((q.up / q.prev - 1) * 20) / 20; if (pct >= 0.05) s.limitPct = pct; } }
const STOCKS = Object.keys(SEC).filter(c => SEC[c].board !== 'index');
const INDICES = ['sh000001', 'sz399001', 'sz399006', 'sh000300', 'sh000905', 'sh000906', 'sh000852', 'sh000688'];

function limitPrices(code, prev) {
  const s = SEC[code];
  if (!s.limitPct) return { up: null, down: null };
  return { up: roundTo(prev * (1 + s.limitPct), s.tick), down: roundTo(prev * (1 - s.limitPct), s.tick) };
}

// ---------- 交易时段 ----------
const PHASES = {
  pre: { name: '盘前', short: '未开盘', canOrder: 'store', canCancel: true, desc: '交易所还没开始接收申报。现在下的单是预埋单，9:15 由券商报送。' },
  auc1: { name: '开盘集合竞价', short: '集合竞价', canOrder: 'auction', canCancel: true, desc: '9:15–9:20：可以申报，也可以撤单。只接受限价单。' },
  auc2: { name: '开盘集合竞价', short: '竞价·不可撤', canOrder: 'auction', canCancel: false, desc: '9:20–9:25：可以申报，但不能撤单。9:25 按成交量最大的价格产生开盘价。' },
  wait: { name: '等待开盘', short: '待开盘', canOrder: 'store', canCancel: false, desc: '9:25–9:30：交易所不接收申报和撤单，券商先暂存，9:30 报送。' },
  cont: { name: '连续竞价', short: '交易中', canOrder: 'cont', canCancel: true, desc: '价格优先、时间优先，逐笔撮合。限价单受价格笼子约束。' },
  lunch: { name: '午间休市', short: '午间休市', canOrder: 'store', canCancel: true, desc: '11:30–13:00：券商暂存委托，13:00 报送。' },
  cauc: { name: '收盘集合竞价', short: '收盘竞价', canOrder: 'auction', canCancel: false, desc: '14:57–15:00：只接受限价单，不能撤单，15:00 集合竞价产生收盘价。' },
  closed1: { name: '已收盘', short: '已收盘', canOrder: 'next', canCancel: true, desc: '15:00 已收盘。可以下盘后固定价格单（15:05–15:30 按收盘价撮合），普通委托算作下一交易日的预埋单。' },
  after: { name: '盘后固定价格交易', short: '盘后交易', canOrder: 'next', canCancel: true, desc: '15:05–15:30：盘后固定价格交易按当日收盘价、时间优先撮合。' },
  closed: { name: '已收盘', short: '已收盘', canOrder: 'next', canCancel: true, desc: '当日已清算。现在下的单是下一交易日的预埋单。' }
};
function phaseAt(t) {
  if (t < T(9, 15)) return 'pre';
  if (t < T(9, 20)) return 'auc1';
  if (t < T(9, 25)) return 'auc2';
  if (t < T(9, 30)) return 'wait';
  if (t < T(11, 30)) return 'cont';
  if (t < T(13, 0)) return 'lunch';
  if (t < T(14, 57)) return 'cont';
  if (t < T(15, 0)) return 'cauc';
  if (t < T(15, 5)) return 'closed1';
  if (t < T(15, 30)) return 'after';
  return 'closed';
}
// 分钟坐标：0 = 9:30，120 = 11:30/13:00，240 = 15:00
function minuteX(t) {
  if (t < T(9, 30)) return 0;
  if (t <= T(11, 30)) return (t - T(9, 30)) / 60;
  if (t < T(13, 0)) return 120;
  if (t < T(14, 57)) return 120 + (t - T(13, 0)) / 60;
  if (t < T(15, 0)) return 237;
  return 240;
}
const TM = (() => { const a = []; for (let i = 0; i <= 120; i++) { const m = 9 * 60 + 30 + i; a.push(String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0')); } for (let i = 1; i <= 120; i++) { const m = 13 * 60 + i; a.push(String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0')); } return a; })();

// ---------- 行情模拟：每个交易日一条分钟路径 ----------
// 2026-10-26 上午用腾讯接口抓到的真实分时；之后（下午和以后的交易日）用随机游走模拟。
const REAL_LAST_X = 120; // 真实数据截止 11:30
const MK = {};
function dailyVol(code) {
  const k = DATA.kline[code];
  if (!k || k.length < 30) return 0.015;
  const rs = []; for (let i = k.length - 60; i < k.length; i++) if (i > 0) rs.push(Math.log(k[i][2] / k[i - 1][2]));
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  return Math.sqrt(rs.reduce((a, b) => a + (b - m) * (b - m), 0) / rs.length) || 0.015;
}
function avgDayVol(code) {
  const k = DATA.kline[code]; if (!k) return 1e6;
  const s = k.slice(-20); return s.reduce((a, r) => a + r[5], 0) / s.length;
}
function buildDay(di, prevCloses) {
  const date = CAL[di];
  const isReal = date === TODAY_REAL;
  for (const code of Object.keys(SEC)) {
    const s = SEC[code], q = DATA.quotes[code];
    const prev = isReal ? q.prev : prevCloses[code];
    let { up, down } = isReal && q.up > 0 ? { up: q.up, down: q.down } : limitPrices(code, prev);
    if (s.board === 'index') { up = null; down = null; }
    const path = new Float64Array(241), cum = new Float64Array(241);
    const r = rng(hashStr(code + date));
    const sdM = dailyVol(code) / Math.sqrt(240);
    const dv = s.board === 'index' ? q.vol || 1e8 : avgDayVol(code);
    const clamp = v => { if (up != null) v = Math.min(up, Math.max(down, v)); return v; };
    let open, startX = 0;
    if (isReal) {
      open = q.open;
      const mins = DATA.minute[code];
      if (mins) {
        const map = {}; for (const m of mins) map[m[0]] = m;
        for (let i = 0; i <= REAL_LAST_X; i++) { const m = map[TM[i]] || null; path[i] = m ? m[1] : (i ? path[i - 1] : open); cum[i] = m ? m[2] : (i ? cum[i - 1] : 0); }
      } else {
        // 指数等没有抓分时：用开盘价到 11:30 价格的布朗桥
        const end = q.price; let w = 0; const n = REAL_LAST_X;
        const ws = [0]; for (let i = 1; i <= n; i++) { w += gauss(r) * sdM; ws.push(w); }
        for (let i = 0; i <= n; i++) { const b = ws[i] - ws[n] * i / n; path[i] = open * Math.exp(b) + (end - open) * i / n; cum[i] = q.vol * (0.08 + 0.92 * i / n); }
        path[0] = open;
      }
      startX = REAL_LAST_X + 1;
    } else {
      open = clamp(roundTo(prev * Math.exp(gauss(r) * sdM * 6), s.tick));
      path[0] = open; cum[0] = dv * 0.03; startX = 1;
    }
    const perMin = dv * 0.97 / 240;
    for (let i = startX; i <= 240; i++) {
      const u = 1.6 - Math.sin(Math.PI * (i / 240)) * 1.1; // U 型成交量
      path[i] = clamp(path[i - 1] * Math.exp(gauss(r) * sdM));
      cum[i] = cum[i - 1] + perMin * u * (0.6 + r() * 0.8);
    }
    for (let i = 0; i <= 240; i++) path[i] = roundTo(path[i], s.board === 'index' ? 0.01 : s.tick);
    // 盘口基础挂单量（手）：来自真实快照
    const lv = q.bids.concat(q.asks).map(x => x[1]).filter(x => x > 0);
    const baseLv = lv.length ? lv.reduce((a, b) => a + b, 0) / lv.length : 50;
    const step = s.tick * Math.max(1, Math.round(prev * 0.00004 / s.tick));
    MK[code] = { date, prev, open, up, down, path, cum, baseLv, step, close: null, auctionVol: cum[0] * 0.4 };
  }
}
function priceAt(code, t) {
  const m = MK[code], s = SEC[code];
  if (t < T(9, 25)) return null;
  if (t < T(9, 30)) return m.open;
  const x = minuteX(t);
  if (x >= 240) return m.path[240];
  const i = Math.floor(x), f = x - i;
  let p = m.path[i] + (m.path[Math.min(240, i + 1)] - m.path[i]) * f;
  if (f > 0 && t < T(14, 57)) p += (noise(hashStr(code) + Math.floor(t / 3)) - 0.5) * m.step * 2;
  p = roundTo(p, s.board === 'index' ? 0.01 : s.tick);
  if (m.up != null) p = Math.min(m.up, Math.max(m.down, p));
  return p;
}
function volAt(code, t) {
  const m = MK[code];
  if (t < T(9, 25)) return 0;
  if (t < T(9, 30)) return m.auctionVol;
  const x = minuteX(t), i = Math.floor(x), f = x - i;
  return m.cum[i] + (m.cum[Math.min(240, i + 1)] - m.cum[i]) * f;
}
// 开盘集合竞价期间的虚拟匹配价
function indicativeAt(code, t) {
  const m = MK[code];
  const k = Math.min(1, (t - T(9, 15)) / 600);
  const p = m.prev + (m.open - m.prev) * (0.4 + 0.6 * k) + (noise(hashStr(code) + Math.floor(t / 10)) - 0.5) * m.step * 2 * (1 - k);
  return roundTo(p, SEC[code].tick);
}
// 一个时刻的完整快照
function snap(code, t) {
  const m = MK[code], s = SEC[code], ph = phaseAt(t);
  const last = priceAt(code, t);
  const p = last == null ? m.prev : last;
  const xEnd = minuteX(t);
  let hi = -Infinity, lo = Infinity;
  if (last != null) { hi = m.open; lo = m.open; for (let i = 0; i <= Math.floor(xEnd); i++) { hi = Math.max(hi, m.path[i]); lo = Math.min(lo, m.path[i]); } hi = Math.max(hi, p); lo = Math.min(lo, p); }
  const vol = volAt(code, t);
  const out = { code, t, phase: ph, last, price: p, prev: m.prev, open: last == null ? null : m.open, high: last == null ? null : hi, low: last == null ? null : lo, vol, amount: vol * 100 * p, up: m.up, down: m.down, bids: [], asks: [] };
  out.chg = last == null ? 0 : p - m.prev; out.pct = last == null ? 0 : (p / m.prev - 1) * 100;
  if (s.board === 'index') return out;
  const r = rng(hashStr(code) + Math.floor(t / 3) * 7);
  const lvl = () => Math.max(1, Math.round(m.baseLv * (0.4 + r() * 1.2)));
  const auction = ph === 'auc1' || ph === 'auc2' || ph === 'pre';
  const ref = auction ? (ph === 'pre' ? m.prev : indicativeAt(code, t)) : p;
  if (auction) out.indicative = ph === 'pre' ? null : ref;
  if (m.up != null && ref >= m.up) {
    out.bids.push([m.up, Math.round(m.baseLv * 300)]); for (let k = 1; k < 5; k++) out.bids.push([roundTo(m.up - m.step * k, s.tick), lvl()]);
  } else if (m.down != null && ref <= m.down) {
    out.asks.push([m.down, Math.round(m.baseLv * 300)]); for (let k = 1; k < 5; k++) out.asks.push([roundTo(m.down + m.step * k, s.tick), lvl()]);
  } else {
    for (let k = 0; k < 5; k++) { const bp = roundTo(ref - m.step * k, s.tick); if (m.down == null || bp >= m.down) out.bids.push([bp, lvl()]); }
    for (let k = 0; k < 5; k++) { const ap = roundTo(ref + s.tick + m.step * k, s.tick); if (m.up == null || ap <= m.up) out.asks.push([ap, lvl()]); }
  }
  if (auction && ph !== 'pre') { out.bids = out.bids.slice(0, 1); out.asks = out.asks.slice(0, 1); out.bids[0] && (out.asks[0] = [out.bids[0][0], Math.round(out.bids[0][1] * 0.7)]); }
  return out;
}

// ---------- 费用 ----------
const FEE_DEFAULT = { rate: 0.00025, min: 5, etfRate: 0.00005, etfMin: 5, mian5: false, regsSeparate: false, mergeOrder: true };
function calcFee(code, side, amount, F) {
  F = F || S.fee;
  const s = SEC[code], etf = s.board === 'etf';
  if (!amount) return { commission: 0, stamp: 0, transfer: 0, handling: 0, reg: 0, total: 0 };
  const rate = etf ? F.etfRate : F.rate;
  const min = F.mian5 ? 0.1 : (etf ? F.etfMin : F.min);
  const commission = Math.max(r2(amount * rate), min);
  const stamp = (!etf && side === 'S') ? r2(amount * 0.0005) : 0;
  const transfer = !etf ? r2(amount * 0.00001) : 0;
  const handling = F.regsSeparate ? r2(amount * (etf ? 0.0000045 : 0.0000341)) : 0;
  const reg = F.regsSeparate ? r2(amount * 0.00002) : 0;
  return { commission, stamp, transfer, handling, reg, total: r2(commission + stamp + transfer + handling + reg) };
}
function divTaxRate(buyDate, sellDate) {
  const b = new Date(buyDate + 'T00:00:00'), e = new Date(sellDate + 'T00:00:00');
  e.setDate(e.getDate() - 1); // 卖出交割日前一日
  const m1 = new Date(b); m1.setMonth(m1.getMonth() + 1);
  const y1 = new Date(b); y1.setFullYear(y1.getFullYear() + 1);
  if (e <= m1) return { rate: 0.2, label: '持股 ≤1 个月，税负 20%' };
  if (e <= y1) return { rate: 0.1, label: '持股 1 个月–1 年，税负 10%' };
  return { rate: 0, label: '持股 >1 年，免税' };
}

// ---------- 账户状态 ----------
let S;
let seq = 1000;
function newState() {
  return {
    di: dayIdx(TODAY_REAL), t: T(10, 28), speed: 10, running: true,
    fee: Object.assign({}, FEE_DEFAULT),
    cash: 0, withdrawable: 0, frozen: 0, depositTotal: 0, depositCap: 400000,
    lots: [], cb: {}, orders: [], fills: [], ledger: [], flows: [], pendingDivTax: [],
    watch: ['sh600519', 'sz300750', 'sh600036', 'sz000858', 'sh510300', 'sh688981', 'sz000001', 'sz002594', 'sh601899', 'sz159915', 'sz002024', 'sz300033'],
    equityHist: [], checks: {}, lessonDone: {}, quiz: {},
    ai: { services: [
      // price：美元 / 百万 tokens（输入、输出、缓存读、缓存写），用来估算费用；不填就只显示 token 数
      { id: 1, name: 'Claude', protocol: 'messages', base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', key: 'sk-ant-•••• 7Qd2', cache: 'auto', price: { in: 2, out: 10, cr: 0.2, cw: 2.5 } },
      { id: 2, name: 'OpenAI', protocol: 'responses', base: 'https://api.openai.com', model: 'gpt-5.6', key: 'sk-•••• 91aF', cache: 'auto', price: null }
    ], active: 1, warm: null, threads: [], cur: 0, mem: [], cfg: { page: true, acts: 10, memory: 'auto', compactAfter: 20 } },
    plan: [
      { code: 'sh510300', name: '沪深300ETF', target: 30000, note: '底仓' },
      { code: 'sh600036', name: '招商银行', target: 3000, note: '不变' },
      { code: 'sz000858', name: '五粮液', target: 0, note: '掉出前 N+10，卖出' },
      { code: 'sz000333', name: '美的集团', target: 400, note: '新进' }
    ],
    acts: [], seeding: false,
    weeks: [], rules: { add: '连续 3 个月跑赢基准，且执行偏差 < 0.05%，再加 10% 资金。', pause: '超额回撤超过 8 个点，或连续 3 个月跑输基准，暂停一个月复盘。', lev: '不加杠杆，不融资融券。' },
    toastQ: []
  };
}
const today = () => CAL[S.di];
const lastPx = code => { const sn = snap(code, S.t); return sn.price; };

function availableQty(code) {
  let held = 0, sellable = 0;
  for (const l of S.lots) if (l.code === code) { held += l.qty; if (l.di < S.di) sellable += l.qty; }
  let frozenSell = 0;
  for (const o of S.orders) if (o.code === code && o.side === 'S' && isLive(o)) frozenSell += o.qty - o.filled;
  return { held, sellable: Math.max(0, sellable - frozenSell), frozenSell, todayBuy: held - sellable };
}
function positions() {
  const map = {};
  for (const l of S.lots) { const p = map[l.code] || (map[l.code] = { code: l.code, qty: 0, cost: S.cb[l.code] || 0 }); p.qty += l.qty; }
  return Object.values(map).filter(p => p.qty > 0).map(p => {
    const px = lastPx(p.code), mv = px * p.qty, sn = snap(p.code, S.t);
    const a = availableQty(p.code);
    // 摊薄成本 = (买入总额 + 费用 - 卖出回款 - 红利) / 持仓
    const costPx = p.cost / p.qty;
    const todayPnl = (sn.last == null ? 0 : (px - sn.prev)) * (p.qty - a.todayBuy) + S.lots.filter(l => l.code === p.code && l.di === S.di).reduce((s, l) => s + (px - l.price) * l.qty, 0);
    return { code: p.code, qty: p.qty, sellable: a.sellable, todayBuy: a.todayBuy, costPx, cost: p.cost, px, mv, pnl: mv - p.cost, pnlPct: (mv / p.cost - 1) * 100, todayPnl };
  }).sort((a, b) => b.mv - a.mv);
}
function account() {
  const ps = positions();
  const mv = ps.reduce((a, p) => a + p.mv, 0);
  const total = S.cash + mv;
  const todayPnl = ps.reduce((a, p) => a + p.todayPnl, 0);
  return { cash: S.cash, available: S.cash - S.frozen, frozen: S.frozen, withdrawable: Math.min(S.withdrawable, S.cash - S.frozen), mv, total, pnl: ps.reduce((a, p) => a + p.pnl, 0), todayPnl, ps };
}
const isLive = o => ['未报', '已报', '部成'].includes(o.status);

function addFlow(kind, amount, note, code) {
  S.flows.unshift({ date: today(), t: S.t, kind, amount: r2(amount), balance: r2(S.cash), note, code });
}
function deposit(amount, date, t) {
  S.cash = r2(S.cash + amount); S.withdrawable = r2(S.withdrawable + amount); S.depositTotal = r2(S.depositTotal + amount);
  S.flows.unshift({ date: date || today(), t: t == null ? S.t : t, kind: '银行转证券', amount, balance: S.cash, note: '模拟入金' });
  logAct('transfer', '银行转证券（模拟入金）' + money(amount) + ' 元');
}
function withdraw(amount) {
  S.cash = r2(S.cash - amount); S.withdrawable = r2(S.withdrawable - amount); S.depositTotal = r2(S.depositTotal - amount);
  addFlow('证券转银行', -amount, '模拟出金');
  logAct('transfer', '证券转银行（模拟出金）' + money(amount) + ' 元');
}

// ---------- 操作记录（AI 的「最近操作」上下文） ----------
// 本机环形缓冲，最多 500 条；kind: view 浏览 / order 委托 / reject 被拦截 / cancel 撤单 / fill 成交 / transfer 转账 / setting 设置 / learn 学习 / export 导出 / system 系统
const ACT_KIND = { view: '浏览', order: '委托', reject: '拦截', cancel: '撤单', fill: '成交', transfer: '转账', setting: '设置', learn: '学习', export: '导出', system: '系统' };
function mkAct(kind, text, ref) { return { id: ++seq, di: S.di, t: S.t, kind, text, ref: ref || null }; }
function logAct(kind, text, ref) {
  if (!S || S.seeding) return;
  const a = S.acts, last = a[a.length - 1];
  if (kind === 'view' && last && last.kind === 'view' && last.text === text) return;
  a.push(mkAct(kind, text, ref));
  if (a.length > 500) a.splice(0, a.length - 500);
}
const ordText = o => (o.side === 'B' ? '买入' : '卖出') + ' ' + SEC[o.code].name + ' ' + intf(o.qty) + (SEC[o.code].board === 'etf' ? '份' : '股') + (o.price != null ? ' @' + fx(o.price, SEC[o.code].dec) : '（' + KIND_NAME[o.kind] + '）');

// ---------- 下单校验 ----------
function cageRange(code, side, sn) {
  const s = SEC[code];
  if (s.board === 'etf') return null; // ⚠️ ETF 是否适用价格笼子待核实
  let base;
  if (side === 'B') base = (sn.asks[0] && sn.asks[0][0]) || (sn.bids[0] && sn.bids[0][0]) || sn.last || sn.prev;
  else base = (sn.bids[0] && sn.bids[0][0]) || (sn.asks[0] && sn.asks[0][0]) || sn.last || sn.prev;
  if (side === 'B') {
    const lim = s.board === 'kcb' ? base * 1.02 : Math.max(base * 1.02, base + 10 * s.tick);
    return { base, max: +(Math.floor(lim / s.tick + 1e-9) * s.tick).toFixed(s.dec) };
  } else {
    const lim = s.board === 'kcb' ? base * 0.98 : Math.min(base * 0.98, base - 10 * s.tick);
    return { base, min: +(Math.ceil(lim / s.tick - 1e-9) * s.tick).toFixed(s.dec) };
  }
}
const MKT_TYPES = {
  SH: [['limit', '限价委托'], ['b5c', '最优五档即时成交剩余撤销'], ['b5l', '最优五档即时成交剩余转限价']],
  SZ: [['limit', '限价委托'], ['cbest', '对手方最优价格'], ['obest', '本方最优价格'], ['ioc', '即时成交剩余撤销'], ['b5c', '最优五档即时成交剩余撤销'], ['fok', '全额成交或撤销']]
};
const KIND_NAME = { limit: '限价', b5c: '五档剩撤', b5l: '五档转限', cbest: '对手最优', obest: '本方最优', ioc: '即成剩撤', fok: '全成或撤', after: '盘后固定价' };

function freezeAmount(code, side, kind, price, qty) {
  if (side !== 'B') return 0;
  const m = MK[code];
  const px = kind === 'limit' ? price : kind === 'after' ? (m.close || lastPx(code)) : (m.up || lastPx(code) * 1.1);
  const amt = px * qty;
  return r2(amt + calcFee(code, 'B', amt).total);
}
// 返回 {ok, level:'block'|'warn', rule, msg, lesson}
function validateOrder(o) {
  const s = SEC[o.code], sn = snap(o.code, S.t), ph = phaseAt(S.t), m = MK[o.code];
  const E = (rule, msg, lesson, level = 'block') => ({ ok: false, level, rule, msg, lesson });
  if (o.kind === 'after') {
    if (s.board === 'index') return E('品种', '指数不能交易。');
    const okWin = (s.ex === 'SH' ? (S.t >= T(9, 30)) : (S.t >= T(9, 15))) && S.t < T(15, 30) && !(S.t >= T(11, 30) && S.t < T(13, 0));
    if (!okWin) return E('盘后固定价格交易时间', (s.ex === 'SH' ? '沪市' : '深市') + '盘后固定价格申报时间为 ' + (s.ex === 'SH' ? '9:30' : '9:15') + '–11:30、13:00–15:30，现在不在申报时间内。', 'time');
  } else {
    if (o.kind !== 'limit' && ph !== 'cont') return E('市价单只在连续竞价阶段接受', '现在是「' + PHASES[ph].name + '」，只能用限价委托。', 'time');
    if (o.kind === 'limit') {
      const p = o.price;
      if (!(p > 0)) return E('价格', '请输入委托价格。');
      if (Math.abs(p / s.tick - Math.round(p / s.tick)) > 1e-6) return E('最小价格变动单位', s.name + ' 的最小价位是 ' + s.tick + ' 元，' + p + ' 不是它的整数倍。', 'unit');
      const up = m.up, down = m.down;
      if (up != null && (p > up + 1e-9 || p < down - 1e-9)) return E('涨跌幅限制', '委托价必须在跌停价 ' + fx(down, s.dec) + ' 和涨停价 ' + fx(up, s.dec) + ' 之间。' + s.name + ' 属于' + BOARD_NAME[s.board] + (s.st ? '风险警示股' : '') + '，涨跌幅 ±' + (s.limitPct * 100) + '%。', 'limit');
    }
  }
  // 数量
  const q = o.qty;
  if (!(q > 0) || q % 1) return E('数量', '请输入委托数量。');
  if (o.side === 'B') {
    if (s.board === 'kcb') { if (q < 200) return E('科创板申报数量', '科创板单笔买入不少于 200 股，超过 200 股的部分可以 1 股为单位递增。', 'unit'); }
    else if (q % 100) return E('申报单位', '买入必须是 100 ' + (s.board === 'etf' ? '份' : '股') + '（1 手）的整数倍。', 'unit');
  } else {
    const a = availableQty(o.code);
    if (q > a.sellable) {
      if (a.todayBuy > 0 && q <= a.sellable + a.todayBuy) return E('T+1', '今天买入的 ' + intf(a.todayBuy) + ' 股要到下一个交易日才能卖出。当前可卖 ' + intf(a.sellable) + ' 股。', 't1');
      return E('可卖数量不足', '当前可卖 ' + intf(a.sellable) + ' 股' + (a.frozenSell ? '（另有 ' + intf(a.frozenSell) + ' 股已被未成交的卖单冻结）' : '') + '。', 't1');
    }
    const isAllOdd = q % 100 !== 0 && q % 100 === a.sellable % 100; // 零股部分一次性卖出
    if (s.board === 'kcb') { if (q < 200 && q !== a.sellable) return E('科创板申报数量', '科创板单笔卖出不少于 200 股；剩余不足 200 股时须一次性卖出。', 'unit'); }
    else if (q % 100 && !isAllOdd) return E('零股', '卖出须为 100 股的整数倍；不足 100 股的零股必须一次性全部卖出（可卖 ' + intf(a.sellable) + ' 股）。', 'unit');
  }
  const maxQ = o.kind === 'limit' || o.kind === 'after' ? s.maxLimit : s.maxLimit / 2;
  if (q > maxQ) return E('单笔申报上限', BOARD_NAME[s.board] + (o.kind === 'limit' ? '限价' : '市价') + '申报单笔不超过 ' + intf(maxQ) + ' 股。', 'unit');
  if (o.side === 'B') {
    const need = freezeAmount(o.code, 'B', o.kind, o.price, q);
    const av = S.cash - S.frozen;
    if (need > av + 1e-6) return E('可用资金不足', '需要冻结 ' + money(need) + ' 元（' + (o.kind === 'limit' ? '委托价' : '市价单按涨停价') + ' × 数量 + 预估费用），可用资金 ' + money(av) + ' 元。', 'fee');
  }
  // 价格笼子：交易所拒收 → 废单（提醒，但允许提交，让用户看到真实后果）
  const willSend = ph === 'cont' || (ph === 'lunch') || ph === 'wait';
  if (o.kind === 'limit' && ph === 'cont') {
    const c = cageRange(o.code, o.side, sn);
    if (c && ((c.max != null && o.price > c.max + 1e-9) || (c.min != null && o.price < c.min - 1e-9)))
      return E('价格笼子', (o.side === 'B' ? '买入' : '卖出') + '基准价 ' + fx(c.base, s.dec) + '，' + (o.side === 'B' ? '买入价不能高于 ' + fx(c.max, s.dec) : '卖出价不能低于 ' + fx(c.min, s.dec)) + '。超出有效申报价格范围的委托会被交易所拒收，成为废单。', 'cage', 'warn');
  }
  return { ok: true };
}

// ---------- 委托 / 撮合 ----------
function placeOrder(o, forceCage) {
  const n0 = S.acts.length, r = placeOrderRaw(o, forceCage);
  // 委托记录插在它引起的成交记录前面
  if (r.ok && !S.seeding) { const d = r.order; S.acts.splice(n0, 0, mkAct(d.status === '废单' ? 'reject' : 'order', '委托' + ordText(d) + ' → ' + d.status + (d.reason ? '：' + d.reason : d.note ? '（' + d.note + '）' : ''), { order: d.id })); }
  return r;
}
function placeOrderRaw(o, forceCage) {
  const v = validateOrder(o);
  if (!v.ok && (v.level === 'block' || !forceCage)) return v;
  const s = SEC[o.code], ph = phaseAt(S.t);
  const ord = { id: ++seq, no: String(100000 + seq), code: o.code, side: o.side, kind: o.kind, price: o.price, qty: o.qty, filled: 0, amt: 0, fee: { commission: 0, stamp: 0, transfer: 0, handling: 0, reg: 0, total: 0 }, status: '已报', di: S.di, t: S.t, fills: [], queue: 0, frozen: 0, reason: '', sendAt: null, inAuction: false, nextDay: false, src: o.src || '' };
  if (!v.ok && !o.preNext) { ord.status = '废单'; ord.reason = '交易所拒绝：超出有效申报价格范围（价格笼子）'; S.orders.unshift(ord); return { ok: true, order: ord }; }
  // 冻结
  if (o.side === 'B') { ord.frozen = freezeAmount(o.code, 'B', o.kind, o.price, o.qty); S.frozen = r2(S.frozen + ord.frozen); }
  S.orders.unshift(ord);
  if (o.preNext) { ord.status = '未报'; ord.nextDay = true; ord.sendAt = T(9, 15); ord.note = '模拟执行：下一交易日 9:15 报送，参加开盘集合竞价'; ord.src = 'plan'; return { ok: true, order: ord }; }
  if (o.kind === 'after') {
    ord.status = ph === 'after' ? '已报' : '已报'; ord.after = true; ord.note = '15:05–15:30 按收盘价撮合';
    return { ok: true, order: ord };
  }
  if (ph === 'pre') { ord.status = '未报'; ord.sendAt = T(9, 15); ord.note = '预埋单，9:15 报送'; }
  else if (ph === 'wait') { ord.status = '未报'; ord.sendAt = T(9, 30); ord.note = '券商暂存，9:30 报送'; }
  else if (ph === 'lunch') { ord.status = '未报'; ord.sendAt = T(13, 0); ord.note = '券商暂存，13:00 报送'; }
  else if (ph === 'closed1' || ph === 'after' || ph === 'closed') { ord.status = '未报'; ord.nextDay = true; ord.sendAt = T(9, 15); ord.note = '下一交易日 9:15 报送'; }
  else if (ph === 'auc1' || ph === 'auc2' || ph === 'cauc') { ord.inAuction = true; ord.note = '已进入集合竞价'; }
  else if (ph === 'cont') { matchOnArrival(ord, snap(o.code, S.t)); }
  return { ok: true, order: ord };
}
function cancelOrder(ord) {
  const ph = phaseAt(S.t);
  if (!isLive(ord)) return { ok: false, msg: '这笔委托已经' + ord.status + '，不能撤单。' };
  if (ord.status !== '未报' && !PHASES[ph].canCancel) return { ok: false, msg: '现在是「' + PHASES[ph].name + '」（' + PHASES[ph].desc.split('：')[0] + '），交易所不接受撤单。', lesson: 'time' };
  ord.status = ord.filled > 0 ? '部撤' : '已撤'; ord.reason = '用户撤单';
  releaseFrozen(ord);
  logAct('cancel', '撤单 ' + ordText(ord) + ' → ' + ord.status + (ord.filled ? '（已成交 ' + intf(ord.filled) + '）' : ''), { order: ord.id });
  return { ok: true };
}
function releaseFrozen(ord) {
  if (ord.side === 'B' && ord.frozen > 0) { S.frozen = r2(S.frozen - ord.frozen); ord.frozen = 0; }
}
function doFill(ord, price, qty, basis) {
  const s = SEC[ord.code];
  qty = Math.min(qty, ord.qty - ord.filled); if (qty <= 0) return;
  const amount = r2(price * qty);
  const newAmt = r2(ord.amt + amount);
  const cum = S.fee.mergeOrder ? calcFee(ord.code, ord.side, newAmt) : null;
  const f = S.fee.mergeOrder ? {} : calcFee(ord.code, ord.side, amount);
  if (S.fee.mergeOrder) for (const k of ['commission', 'stamp', 'transfer', 'handling', 'reg', 'total']) f[k] = r2(cum[k] - ord.fee[k]);
  for (const k of ['commission', 'stamp', 'transfer', 'handling', 'reg', 'total']) ord.fee[k] = r2(ord.fee[k] + f[k]);
  ord.amt = newAmt; ord.filled += qty;
  ord.status = ord.filled >= ord.qty ? '已成' : '部成';
  const fill = { id: ++seq, no: 'C' + (200000 + seq), ord: ord.id, code: ord.code, side: ord.side, price, qty, amount, fee: f, di: S.di, t: S.t, basis };
  ord.fills.push(fill.id); S.fills.unshift(fill);
  let net;
  if (ord.side === 'B') {
    net = -r2(amount + f.total);
    S.cash = r2(S.cash + net);
    // 释放对应冻结
    const rel = ord.status === '已成' ? ord.frozen : Math.min(ord.frozen, r2(-net));
    ord.frozen = r2(ord.frozen - rel); S.frozen = r2(S.frozen - rel);
    S.lots.push({ code: ord.code, qty, price, di: S.di, date: today(), div: 0 });
    S.cb[ord.code] = r2((S.cb[ord.code] || 0) + amount + f.total);
  } else {
    net = r2(amount - f.total);
    S.cash = r2(S.cash + net);
    // 先进先出，计算红利税
    let left = qty, divTax = 0, notes = [];
    const lots = S.lots.filter(l => l.code === ord.code && l.di < S.di);
    for (const l of lots) {
      if (!left) break;
      const take = Math.min(l.qty, left);
      if (l.div > 0) {
        const tr = divTaxRate(l.date, today());
        const tax = r2(l.div * take * tr.rate);
        if (tax > 0) { divTax += tax; notes.push(l.date + ' 买入 ' + take + ' 股，' + tr.label + '，补税 ' + money(tax)); }
      }
      l.qty -= take; left -= take;
    }
    // 卖出回款摊薄剩余成本（同花顺「摊薄成本」口径）；清仓后成本归零
    S.lots = S.lots.filter(l => l.qty > 0);
    if (S.lots.some(l => l.code === ord.code)) S.cb[ord.code] = r2(S.cb[ord.code] - net); else delete S.cb[ord.code];
    if (divTax > 0) { S.pendingDivTax.push({ code: ord.code, amount: r2(divTax), notes, fill: fill.id }); fill.divTaxPending = r2(divTax); fill.divNotes = notes; }
  }
  fill.net = net;
  S.ledger.unshift({ id: fill.id, date: today(), t: S.t, code: ord.code, name: s.name, biz: ord.side === 'B' ? '证券买入' : '证券卖出', price, qty, amount, ...f, net, balance: S.cash, no: ord.no });
  addFlow(ord.side === 'B' ? '证券买入' : '证券卖出', net, s.name + ' ' + qty + (s.board === 'etf' ? '份' : '股') + ' @' + fx(price, s.dec), ord.code);
  if (ord.status === '已成') releaseFrozen(ord);
  maybeAutoCheck(ord, fill);
  logAct('fill', '成交 ' + (ord.side === 'B' ? '买入' : '卖出') + ' ' + s.name + ' ' + intf(qty) + ' @' + fx(price, s.dec) + '，费用 ' + money(f.total) + ' 元（' + basis.split('：')[0].replace(/^\d\d:\d\d:\d\d /, '') + '）', { fill: fill.id });
  toast((ord.side === 'B' ? '买入' : '卖出') + '成交：' + s.name + ' ' + qty + ' @ ' + fx(price, s.dec), 'fill', fill.id);
}
function walkBook(ord, levels, limitPx) {
  const s = SEC[ord.code];
  const used = [];
  for (const [p, v] of levels) {
    if (ord.filled >= ord.qty) break;
    if (limitPx != null && (ord.side === 'B' ? p > limitPx + 1e-9 : p < limitPx - 1e-9)) break;
    const can = Math.min(v * 100, ord.qty - ord.filled);
    used.push([p, can, v]);
    doFill(ord, p, can, hms(S.t) + ' 快照：' + (ord.side === 'B' ? '卖' : '买') + (used.length) + ' ' + fx(p, s.dec) + ' × ' + intf(v) + ' 手，本单' + (ord.side === 'B' ? '主动买入' : '主动卖出') + ' ' + intf(can) + ' 股，成交价取该档价格');
  }
  return used;
}
function matchOnArrival(ord, sn) {
  const s = SEC[ord.code];
  const opp = ord.side === 'B' ? sn.asks : sn.bids;
  const own = ord.side === 'B' ? sn.bids : sn.asks;
  if (ord.kind === 'limit') {
    walkBook(ord, opp, ord.price);
    if (ord.filled < ord.qty) {
      const lvl = own.find(l => Math.abs(l[0] - ord.price) < 1e-9);
      ord.queue = lvl ? lvl[1] * 100 : 0;
      ord.note = ord.queue ? '挂单排队，前方约 ' + intf(ord.queue) + ' 股' : '挂单，等待对手方';
    }
    return;
  }
  // 市价类
  if (ord.kind === 'obest') {
    if (!own[0]) { ord.status = '已撤'; ord.reason = '本方无申报，自动撤单'; releaseFrozen(ord); return; }
    ord.kind = 'limit'; ord.price = own[0][0]; ord.queue = own[0][1] * 100; ord.note = '按本方最优价 ' + fx(ord.price, s.dec) + ' 转为限价挂单'; return;
  }
  if (ord.kind === 'fok') {
    const tot = opp.slice(0, 5).reduce((a, l) => a + l[1] * 100, 0);
    if (tot < ord.qty) { ord.status = '已撤'; ord.reason = '对手方五档数量不足以全部成交，全部撤销'; releaseFrozen(ord); return; }
    walkBook(ord, opp, null); return;
  }
  if (ord.kind === 'cbest') {
    if (!opp[0]) { ord.status = '已撤'; ord.reason = '对手方无申报，自动撤单'; releaseFrozen(ord); return; }
    const p0 = opp[0][0]; walkBook(ord, [opp[0]], null);
    if (ord.filled < ord.qty) { ord.kind = 'limit'; ord.price = p0; ord.queue = 0; ord.note = '剩余部分以 ' + fx(p0, s.dec) + ' 转为限价挂单'; }
    return;
  }
  const levels = opp.slice(0, 5);
  walkBook(ord, levels, null);
  if (ord.filled < ord.qty) {
    if (ord.kind === 'b5l' && ord.fills.length) {
      const lastF = S.fills.find(f => f.id === ord.fills[ord.fills.length - 1]);
      ord.kind = 'limit'; ord.price = lastF.price; ord.queue = 0; ord.note = '剩余部分以最后成交价 ' + fx(lastF.price, s.dec) + ' 转为限价挂单';
    } else { ord.status = ord.filled ? '部撤' : '已撤'; ord.reason = '五档内未成交部分自动撤销'; releaseFrozen(ord); }
  }
  // 市价买单冻结差额退回：按实际成交后重新计算剩余冻结
  if (ord.side === 'B' && !isLive(ord)) releaseFrozen(ord);
}
// 连续竞价：两个快照之间推进挂单
function stepResting(ord, sn, prevVol) {
  if (ord.kind !== 'limit' || !isLive(ord) || ord.status === '未报' || ord.inAuction) return;
  const s = SEC[ord.code];
  const p = sn.last; if (p == null) return;
  const better = ord.side === 'B' ? p < ord.price - 1e-9 : p > ord.price + 1e-9;
  if (better) {
    doFill(ord, ord.price, ord.qty - ord.filled, hms(sn.t) + ' 成交价 ' + fx(p, s.dec) + (ord.side === 'B' ? ' 低于' : ' 高于') + '委托价，说明 ' + fx(ord.price, s.dec) + ' 上的挂单已全部成交，本单按委托价成交');
    return;
  }
  if (Math.abs(p - ord.price) < 1e-9) {
    const dv = Math.max(0, (sn.vol - prevVol) * 100);
    if (!dv) return;
    const before = ord.queue;
    ord.queue -= dv * 0.5; // 保守：同价位成交量只有一半算在本方队列
    if (ord.queue < 0) {
      const can = Math.floor(-ord.queue / 100) * 100 || Math.min(100, ord.qty - ord.filled);
      ord.queue = 0;
      doFill(ord, ord.price, can, hms(sn.t) + ' 在委托价 ' + fx(p, s.dec) + ' 成交 ' + intf(dv) + ' 股（按一半计入本方队列），排在前面的约 ' + intf(Math.max(0, before)) + ' 股已成交完，本单开始成交');
    } else ord.note = '排队中，前方约 ' + intf(Math.round(ord.queue)) + ' 股';
  }
}
function crossAuction(kind) {
  // kind: 'open' at 9:25, 'close' at 15:00
  for (const ord of S.orders) {
    if (!ord.inAuction || !isLive(ord) || ord.di !== S.di) continue;
    const s = SEC[ord.code], m = MK[ord.code];
    const O = kind === 'open' ? m.open : m.path[240];
    const name = kind === 'open' ? '开盘' : '收盘';
    const ok = ord.side === 'B' ? (ord.price > O + 1e-9 || (Math.abs(ord.price - O) < 1e-9 && (m.up == null || O < m.up))) : (ord.price < O - 1e-9 || (Math.abs(ord.price - O) < 1e-9 && (m.down == null || O > m.down)));
    if (ok) doFill(ord, O, ord.qty - ord.filled, (kind === 'open' ? '09:25:00' : '15:00:00') + ' ' + name + '集合竞价：' + name + '价 ' + fx(O, s.dec) + (ord.side === 'B' ? ' ≤ ' : ' ≥ ') + '委托价 ' + fx(ord.price, s.dec) + '，全部按' + name + '价成交（集合竞价所有成交都用同一个价格）');
    else {
      if (kind === 'open') { ord.inAuction = false; const sn = snap(ord.code, T(9, 30)); const own = ord.side === 'B' ? sn.bids : sn.asks; const l = own.find(x => Math.abs(x[0] - ord.price) < 1e-9); ord.queue = l ? l[1] * 100 : 0; ord.note = (Math.abs(ord.price - O) < 1e-9 ? '委托价等于开盘价但' + (ord.side === 'B' ? '开盘即涨停，排在封单之后' : '开盘即跌停') : '委托价未达到开盘价') + '，转入连续竞价排队'; }
      else ord.note = '收盘集合竞价未成交';
    }
  }
}
function afterHoursMatch() {
  for (const ord of S.orders) {
    if (!ord.after || !isLive(ord) || ord.di !== S.di) continue;
    const m = MK[ord.code], s = SEC[ord.code], c = m.path[240];
    if (ord.side === 'B' && ord.price != null && ord.price < c - 1e-9) continue;
    if (ord.side === 'S' && ord.price != null && ord.price > c + 1e-9) continue;
    doFill(ord, c, ord.qty - ord.filled, hms(S.t) + ' 盘后固定价格交易：按当日收盘价 ' + fx(c, s.dec) + ' 成交（时间优先；原型假设对手方数量充足）');
  }
}
function releaseQueued(at) {
  for (const ord of S.orders) {
    if (ord.status !== '未报' || ord.sendAt !== at) continue;
    if (ord.nextDay && ord.di === S.di) continue;
    ord.status = '已报'; ord.note = '';
    if (at === T(9, 15)) { ord.inAuction = true; ord.note = '已报送，进入开盘集合竞价'; }
    else matchOnArrival(ord, snap(ord.code, at));
  }
}
function settle() {
  let n = 0;
  for (const ord of S.orders) {
    if (ord.di === S.di && isLive(ord) && !ord.nextDay) { ord.status = ord.filled ? '部撤' : '已撤'; ord.reason = '当日有效，收盘后未成交部分由系统撤销'; releaseFrozen(ord); n++; }
  }
  S.withdrawable = r2(S.cash - S.frozen);
  recordEquity();
  S.settled = S.di;
  logAct('system', '日终清算' + (n ? '，系统撤销 ' + n + ' 笔未成交委托' : ''));
  toast('日终清算完成：T+1 股份明天可卖，卖出资金明天可取' + (n ? '，系统撤销 ' + n + ' 笔未成交委托' : ''), 'info');
}
function recordEquity() {
  const a = account();
  const i = S.equityHist.findIndex(e => e.date === today());
  const row = { date: today(), total: r2(a.total), deposit: S.depositTotal };
  if (i >= 0) S.equityHist[i] = row; else S.equityHist.push(row);
}
function rollDay() {
  const closes = {}; for (const c in MK) closes[c] = MK[c].path[240];
  // 把当日 K 线追加到历史（K 线页使用）
  for (const c in MK) { const k = DATA.kline[c]; if (k && k[k.length - 1][0] !== MK[c].date) { const m = MK[c]; let hi = -1e18, lo = 1e18; for (const v of m.path) { hi = Math.max(hi, v); lo = Math.min(lo, v); } k.push([m.date, m.open, m.path[240], hi, lo, m.cum[240]]); } }
  if (S.settled !== S.di) settle();
  S.di++;
  buildDay(S.di, closes);
  // 卖出时产生的红利税，在下一交易日清算时扣收
  for (const p of S.pendingDivTax) {
    S.cash = r2(S.cash - p.amount); S.withdrawable = r2(S.withdrawable - p.amount);
    if (S.cb[p.code] != null) S.cb[p.code] = r2(S.cb[p.code] + p.amount);
    S.ledger.unshift({ id: ++seq, date: today(), t: T(8, 0), code: p.code, name: SEC[p.code].name, biz: '股息红利税补', price: 0, qty: 0, amount: 0, commission: 0, stamp: 0, transfer: 0, handling: 0, reg: 0, total: 0, divTax: p.amount, net: -p.amount, balance: S.cash, no: '', note: p.notes.join('；') });
    addFlow('股息红利税补', -p.amount, SEC[p.code].name + '（卖出时按持股期限计算）', p.code);
  }
  if (S.pendingDivTax.length) logAct('system', '扣收股息红利税 ' + money(S.pendingDivTax.reduce((a, p) => a + p.amount, 0)) + ' 元');
  if (S.pendingDivTax.length) toast('已扣收股息红利税 ' + money(S.pendingDivTax.reduce((a, p) => a + p.amount, 0)) + ' 元，见交割单', 'info');
  S.pendingDivTax = [];
}

// ---------- 时钟推进 ----------
const EVENTS = [[T(9, 15), 'send915'], [T(9, 25), 'openCross'], [T(9, 30), 'send930'], [T(13, 0), 'send1300'], [T(15, 0), 'closeCross'], [T(15, 5), 'afterStart'], [T(15, 30), 'settle']];
function runEvent(name) {
  if (name === 'send915') releaseQueued(T(9, 15));
  if (name === 'openCross') crossAuction('open');
  if (name === 'send930') releaseQueued(T(9, 30));
  if (name === 'send1300') releaseQueued(T(13, 0));
  if (name === 'closeCross') { crossAuction('close'); for (const c in MK) MK[c].close = MK[c].path[240]; }
  if (name === 'afterStart') afterHoursMatch();
  if (name === 'settle') settle();
}
function stepContinuous(t0, t1) {
  const codes = [...new Set(S.orders.filter(o => isLive(o) && o.status !== '未报' && !o.inAuction && o.kind === 'limit').map(o => o.code))];
  if (!codes.length) return;
  const span = t1 - t0; const step = Math.max(3, span / 1500);
  for (const code of codes) {
    let tv = t0, pv = volAt(code, t0);
    while (tv < t1) {
      tv = Math.min(t1, tv + step);
      const ph = phaseAt(tv); if (ph !== 'cont') { pv = volAt(code, tv); continue; }
      const sn = snap(code, tv);
      const saveT = S.t; S.t = tv;
      for (const o of S.orders) if (o.code === code) stepResting(o, sn, pv);
      S.t = saveT;
      pv = sn.vol;
    }
  }
}
function advanceTo(t1) {
  let t0 = S.t;
  if (t1 > T(23, 59, 59)) t1 = T(23, 59, 59);
  for (const [et, name] of EVENTS) {
    if (et > t0 && et <= t1) { stepContinuous(t0, et); S.t = et; runEvent(name); t0 = et; }
  }
  stepContinuous(t0, t1);
  S.t = t1;
}
function gotoNextDay(at) {
  advanceTo(T(23, 59, 59));
  rollDay();
  S.t = T(9, 0);
  advanceTo(at || T(9, 14, 30));
}

// ---------- 学习进度自动打勾 ----------
function maybeAutoCheck(ord, fill) {
  const s = SEC[ord.code];
  if (ord.side === 'B' && s.board === 'etf' && /集合竞价/.test(fill.basis) && /开盘/.test(fill.basis)) {
    if (!S.checks['s0-e1']) { S.checks['s0-e1'] = { auto: true, date: today(), fill: fill.id }; toast('学习进度：已完成「用集合竞价买一手宽基 ETF」', 'learn'); }
  }
}

// ---------- 初始化：示例账户（2026-06-01 起） ----------
function seed() {
  S = newState();
  S.seeding = true;
  buildDay(S.di, null);
  const save = { di: S.di, t: S.t };
  const at = (date, t) => { S.di = dayIdx(date); S.t = t; };
  const k = (code, date) => DATA.kline[code].find(r => r[0] === date);
  at('2026-06-01', T(10, 2)); deposit(300000, '2026-06-01', T(10, 2));
  // 用费用引擎回放示例成交，保证数字自洽
  const fakeFill = (code, side, date, t, price, qty, basis) => {
    at(date, t);
    const ord = { id: ++seq, no: String(100000 + seq), code, side, kind: 'limit', price, qty, filled: 0, amt: 0, fee: { commission: 0, stamp: 0, transfer: 0, handling: 0, reg: 0, total: 0 }, status: '已报', di: S.di, t, fills: [], queue: 0, frozen: 0 };
    S.orders.unshift(ord); doFill(ord, price, qty, basis); return ord;
  };
  fakeFill('sh600036', 'B', '2026-06-02', T(10, 5), roundTo(k('sh600036', '2026-06-02')[2], 0.01), 2000, '历史示例成交');
  // 示例分红（数字为原型示例，不是招商银行真实分红方案）
  at('2026-07-10', T(9, 0));
  for (const l of S.lots) if (l.code === 'sh600036') l.div += 2.0;
  S.cash = r2(S.cash + 4000); S.withdrawable = r2(S.withdrawable + 4000);
  S.cb.sh600036 = r2(S.cb.sh600036 - 4000);
  S.ledger.unshift({ id: ++seq, date: '2026-07-10', t: T(9, 0), code: 'sh600036', name: '招商银行', biz: '股息入账', price: 0, qty: 2000, amount: 4000, commission: 0, stamp: 0, transfer: 0, handling: 0, reg: 0, total: 0, net: 4000, balance: S.cash, no: '', note: '示例：每股派 2.00 元（原型示例数据）。派息时不扣税，卖出时按持股期限补扣。' });
  addFlow('股息入账', 4000, '招商银行 每股 2.00 元（示例）', 'sh600036');
  fakeFill('sh510300', 'B', '2026-09-15', T(9, 45), roundTo(k('sh510300', '2026-09-15')[2], 0.001), 20000, '历史示例成交');
  fakeFill('sz000858', 'B', '2026-10-23', T(14, 20), roundTo(k('sz000858', '2026-10-23')[2], 0.01), 500, '历史示例成交');
  // 历史净值
  buildEquityHistory();
  // 今天：宁德时代集合竞价买入（T+1 演示）。从这里开始记录操作
  S.di = save.di; S.seeding = false;
  at(TODAY_REAL, T(9, 21, 40));
  const o1 = { id: ++seq, no: String(100000 + seq), code: 'sz300750', side: 'B', kind: 'limit', price: 236.00, qty: 200, filled: 0, amt: 0, fee: { commission: 0, stamp: 0, transfer: 0, handling: 0, reg: 0, total: 0 }, status: '已报', di: S.di, t: S.t, fills: [], queue: 0, frozen: 0, inAuction: true };
  o1.frozen = freezeAmount('sz300750', 'B', 'limit', 236, 200); S.frozen = r2(S.frozen + o1.frozen);
  S.orders.unshift(o1);
  logAct('order', '委托' + ordText(o1) + ' → 已报（开盘集合竞价）', { order: o1.id });
  S.t = T(9, 25); crossAuction('open');
  S.t = T(10, 3, 40); logAct('view', '个股 · 平安银行');
  // 平安银行挂单排队（演示撤单）
  S.t = T(10, 5, 12);
  placeOrder({ code: 'sz000001', side: 'B', kind: 'limit', price: 11.12, qty: 1000 });
  // 招商银行卖出超价格笼子 → 废单（演示）
  S.t = T(10, 11, 55); logAct('view', '卖出 · 招商银行');
  S.t = T(10, 12, 30);
  const sn = snap('sh600036', S.t);
  placeOrder({ code: 'sh600036', side: 'S', kind: 'limit', price: roundTo(sn.bids[0][0] * 0.96, 0.01), qty: 1000 }, true);
  S.t = T(10, 14, 5); logAct('view', '查询 · 当日委托');
  S.t = save.t;
  if (typeof seedAI === 'function') seedAI();
  S.toastQ = [];
}
function buildEquityHistory() {
  // 根据批次和日线收盘价回放 2026-06-01 → 昨天的每日总资产
  const start = dayIdx('2026-06-01'), end = dayIdx(TODAY_REAL) - 1;
  const trades = [
    { di: dayIdx('2026-06-02'), code: 'sh600036', qty: 2000 },
    { di: dayIdx('2026-09-15'), code: 'sh510300', qty: 20000 },
    { di: dayIdx('2026-10-23'), code: 'sz000858', qty: 500 }
  ];
  const cashAt = {};
  // 现金变化：按流水回放
  const flows = S.flows.slice().reverse();
  let cash = 0, fi = 0;
  for (let d = start; d <= end; d++) {
    while (fi < flows.length && dayIdx(flows[fi].date) <= d) { cash = flows[fi].balance; fi++; }
    cashAt[d] = cash;
    let mv = 0;
    for (const tr of trades) if (tr.di <= d) { const r = DATA.kline[tr.code].find(x => x[0] === CAL[d]); if (r) mv += r[2] * tr.qty; }
    S.equityHist.push({ date: CAL[d], total: r2(cash + mv), deposit: 300000 });
  }
}

// ---------- toast 队列（UI 读取） ----------
function toast(msg, kind, ref) { if (S) S.toastQ.push({ msg, kind, ref }); }
