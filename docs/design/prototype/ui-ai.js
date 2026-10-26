/* AShareSim 原型 · AI 助手：页面上下文、最近操作、对话与记忆 */
'use strict';
const protoName = p => p === 'messages' ? 'Anthropic Messages' : 'OpenAI Responses';
const AI_SCREENS = ['ai', 'aiThreads', 'aiMemory', 'aiCtx', 'aiServices', 'aiEdit'];
const aiSvc = () => S.ai.services.find(s => s.id === S.ai.active);
const feeCalibrated = () => !!S.checks['s0-e0'];
const feeState = () => '费率：股票万 ' + (S.fee.rate * 1e4).toFixed(2) + '、ETF 万 ' + (S.fee.etfRate * 1e4).toFixed(2) + '，' + (S.fee.mian5 ? '免五' : '最低 5 元') + '；' + (feeCalibrated() ? '已用真实交割单校准' : '还没有用真实交割单校准，当前是占位默认值');

// ---------- 页面上下文：每个页面告诉 AI「用户正在看什么」 ----------
// 返回 { name, lines, tip }：name 页面名；lines 页面上用户看得到的关键数据；tip「解释这个页面」时的要点
const aiPlain = h => String(h).replace(/<span class="sub[^"]*">/, ' · ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
function posLine(code) {
  const p = positions().find(x => x.code === code);
  if (!p) return '我没有持仓';
  return '我的持仓 ' + intf(p.qty) + unitName(code) + '，可卖 ' + intf(p.sellable) + (p.todayBuy ? '（今天买入的 ' + intf(p.todayBuy) + ' 受 T+1 限制）' : '') + '，摊薄成本 ' + px(code, p.costPx) + '，浮动盈亏 ' + sgn(p.pnl) + ' 元（' + pctS(p.pnlPct) + '）';
}
function quoteLine(code) {
  const s = SEC[code], sn = snap(code, S.t);
  return s.name + ' ' + s.sym + ' 现价 ' + px(code, sn.price) + '（' + pctS(sn.pct) + '）' + (sn.open != null ? '，今开 ' + px(code, sn.open) + ' 最高 ' + px(code, sn.high) + ' 最低 ' + px(code, sn.low) : '，还没开盘') + (s.board !== 'index' ? '，涨停 ' + px(code, MK[code].up) + ' 跌停 ' + px(code, MK[code].down) : '');
}
const ordLine = o => hms(o.t).slice(0, 5) + ' ' + ordText(o) + ' ' + o.status + (o.filled && o.status !== '已成' ? '（已成 ' + intf(o.filled) + '）' : '') + (o.reason ? '：' + o.reason : '');
const PAGE_AI = {
  watch: () => ({ name: '自选', lines: S.watch.slice(0, 8).map(c => { const sn = snap(c, S.t); return SEC[c].name + ' ' + px(c, sn.price) + ' ' + pctS(sn.pct); }), tip: '自选按你添加的顺序排列，可以按涨跌幅排序。点一行进入个股页。' }),
  market: () => ({ name: '行情 · ' + { idx: '指数', main: '沪深主板', cyb: '创业板', kcb: '科创板', etf: 'ETF' }[mktSeg], lines: INDICES.slice(0, 5).map(c => { const sn = snap(c, S.t); return SEC[c].name + ' ' + fx(sn.price, 2) + ' ' + pctS(sn.pct); }), tip: '指数反映一篮子股票的整体涨跌：沪深 300 是大盘蓝筹，中证 500 / 1000 是中小盘，创业板指和科创 50 偏成长股。' }),
  stock: p => {
    const c = p.code, s = SEC[c], q = DATA.quotes[c] || {};
    const L = [quoteLine(c), BOARD_NAME[s.board] + (s.st ? '（风险警示）' : '') + (s.board !== 'index' ? '，涨跌幅限制 ±' + s.limitPct * 100 + '%' : '')];
    if (s.board !== 'index' && s.board !== 'etf' && q.pe != null) L.push('市盈率（动）' + fx(q.pe, 1) + '，市净率 ' + fx(q.pb, 2) + '，总市值 ' + fx(q.totalCap, 0) + ' 亿');
    L.push('图表：' + { min: '分时', day: '日K', week: '周K', month: '月K' }[chartTab] + (s.board !== 'index' ? '；下方：' + (bookTab === 'book' ? '五档盘口' : '成交明细') : ''));
    if (s.board !== 'index') L.push(posLine(c));
    return { name: '个股 · ' + s.name, lines: L, tip: s.board === 'index' ? '指数不能直接买卖，可以买跟踪它的 ETF。' : '上面是行情，中间是图表和五档盘口，「规则卡」写明了这只股票适用的涨跌幅、申报单位和价格笼子，最下面是公司简况。' };
  },
  order: p => {
    if (p.side === 'C') return { name: '撤单', lines: S.orders.filter(isLive).map(ordLine), tip: '这里只列出还能撤的委托。9:20–9:25 和 14:57–15:00 交易所不接受撤单。' };
    if (p.side === 'P') return { name: '下单 · 持仓', lines: positions().map(x => SEC[x.code].name + ' ' + intf(x.qty) + '，可卖 ' + intf(x.sellable)), tip: '点一只持仓直接进入卖出。' };
    const c = p.code || 'sh600519', s = SEC[c], isB = p.side === 'B', ph = phaseAt(S.t);
    const L = ['方向：' + (OF.kind === 'after' ? '盘后固定价格' : '') + (isB ? '买入' : '卖出') + '；证券：' + s.name + ' ' + s.sym + '（' + BOARD_NAME[s.board] + '）', quoteLine(c)];
    L.push('表单：' + KIND_NAME[OF.kind] + (OF.kind === 'limit' ? '，价格 ' + fx(OF.price, s.dec) : '') + '，数量 ' + (OF.qty || '未填'));
    if (isB) L.push('可用资金 ' + money(S.cash - S.frozen) + '，最多可买 ' + intf(maxBuy(c)) + unitName(c));
    else { const a = availableQty(c); L.push('可卖 ' + intf(a.sellable) + (a.todayBuy ? '，今天买入的 ' + intf(a.todayBuy) + ' 受 T+1 限制' : '')); }
    const cg = ph === 'cont' ? cageRange(c, p.side, snap(c, S.t)) : null;
    if (cg) L.push('价格笼子：' + (isB ? '买入价 ≤ ' + px(c, cg.max) : '卖出价 ≥ ' + px(c, cg.min)));
    const q = parseInt(OF.qty) || 0;
    if (q && OF.kind === 'limit') { const v = validateOrder({ code: c, side: p.side, kind: OF.kind, price: OF.price, qty: q }); L.push(v.ok ? '表单校验通过，预估费用 ' + money(calcFee(c, p.side, r2(OF.price * q)).total) + ' 元' : '表单校验不通过：' + v.rule + '。' + v.msg); }
    L.push('交易时段：' + PHASES[ph].name + '，' + (PHASES[ph].canCancel ? '可以撤单' : '不能撤单'));
    L.push(feeState());
    return { name: (isB ? '买入' : '卖出') + ' · ' + s.name, lines: L, tip: sendTimeText(ph, OF.kind) };
  },
  trade: () => { const a = account(); return { name: '交易', lines: ['总资产 ' + money(a.total) + '，可用 ' + money(a.available) + '，可取 ' + money(a.withdrawable) + '，当日盈亏 ' + sgn(a.todayPnl) + ' 元'].concat(a.ps.map(x => SEC[x.code].name + ' ' + intf(x.qty) + '，可卖 ' + intf(x.sellable) + '，盈亏 ' + pctS(x.pnlPct))), tip: '「可用」是能用来买入的钱，「可取」是能转回银行的钱。今天卖出的钱当天可用，下一交易日才可取。' }; },
  positions: () => PAGE_AI.trade(),
  orders: p => {
    const tb = p.tab || 'today', nm = { today: '当日委托', fills: '当日成交', hist: '历史委托', ledger: '交割单' }[tb];
    let L;
    if (tb === 'ledger') L = S.ledger.slice(0, 6).map(l => l.date + ' ' + l.biz + ' ' + l.name + (l.qty ? ' ' + intf(l.qty) + ' @' + px(l.code, l.price) : '') + '，费用 ' + money(l.total + (l.divTax || 0)) + '，发生金额 ' + money(l.net));
    else if (tb === 'fills') L = S.fills.filter(f => f.di === S.di).map(f => hms(f.t).slice(0, 5) + ' ' + (f.side === 'B' ? '买入' : '卖出') + ' ' + SEC[f.code].name + ' ' + intf(f.qty) + ' @' + px(f.code, f.price));
    else L = S.orders.filter(o => tb === 'today' ? o.di === S.di || (o.nextDay && isLive(o)) : o.di < S.di).slice(0, 8).map(ordLine);
    return { name: '查询 · ' + nm, lines: L.length ? L : ['（空）'], tip: tb === 'ledger' ? '交割单是券商给你的正式结算记录，每一笔都列出佣金、印花税、过户费；股息红利税补单独一行。' : '委托状态和券商一致：未报、已报、部成、已成、已撤、部撤、废单。点一笔可以看成交依据。' };
  },
  orderDetail: p => { const o = S.orders.find(x => x.id === p.id); return { name: '委托详情 · ' + SEC[o.code].name, lines: [ordLine(o), '合同号 ' + o.no + '，' + KIND_NAME[o.kind] + '，已成交 ' + intf(o.filled) + '，费用 ' + money(o.fee.total)].concat(o.note && isLive(o) ? ['状态说明：' + o.note] : []).concat(o.fills.map(id => { const f = S.fills.find(x => x.id === id); return '成交 ' + px(o.code, f.price) + ' × ' + intf(f.qty) + '：' + f.basis; })), tip: '时间线从提交委托开始，列出每一次成交和它的依据。' }; },
  fillDetail: p => { const f = S.fills.find(x => x.id === p.id), fe = f.fee; return { name: '成交详情 · ' + SEC[f.code].name, lines: [CAL[f.di] + ' ' + hms(f.t) + ' ' + (f.side === 'B' ? '买入' : '卖出') + ' ' + SEC[f.code].name + ' ' + intf(f.qty) + ' @' + px(f.code, f.price) + '，成交金额 ' + money(f.amount), '佣金 ' + money(fe.commission) + '，印花税 ' + money(fe.stamp) + '，过户费 ' + money(fe.transfer) + '，合计 ' + money(fe.total), '成交依据：' + f.basis].concat(f.divTaxPending ? ['待补扣股息红利税 ' + money(f.divTaxPending) + '：' + f.divNotes.join('；')] : []).concat([feeState()]), tip: '「成交依据」说明了这笔为什么在这个价格、这个时间成交。' }; },
  transfer: () => ({ name: '银证转账', lines: ['资金余额 ' + money(S.cash) + '，可取 ' + money(account().withdrawable), '累计净入金 ' + money(S.depositTotal) + ' / 上限 ' + money(S.depositCap)], tip: '这是 App 里唯一「模拟」的部分：银行转证券就是模拟入金。' }),
  flows: () => ({ name: '资金流水', lines: S.flows.slice(0, 6).map(f => f.date + ' ' + f.kind + ' ' + money(f.amount) + ' ' + (f.note || '')), tip: '资金流水记录每一笔钱的进出，可以和交割单互相核对。' }),
  learn: () => ({ name: '学习', lines: STAGES.map(x => '阶段 ' + x.no + ' ' + x.title + '：' + stageDone(x) + '/' + stageItems(x).length), tip: '当前阶段是「' + curStage().title + '」。' }),
  stage: p => { const st = STAGES.find(x => x.no === p.no); return { name: '阶段 ' + st.no + ' · ' + st.title, lines: stageItems(st).map(i => (S.checks[i[0]] ? '✓ ' : '○ ') + i[1]), tip: st.goal }; },
  lessons: () => ({ name: '规则课', lines: ['已通过 ' + Object.keys(S.lessonDone).length + ' / ' + LESSONS.length + ' 课'], tip: '每课一屏讲解加 1–3 道小测。' }),
  lesson: p => { const l = LESSONS.find(x => x.id === p.id); return { name: '规则课 · ' + l.title, lines: [aiPlain(l.body).slice(0, 120) + '…'].concat(l.quiz.map((q, i) => { const a = S.quiz[l.id + i]; return '小测 ' + (i + 1) + '「' + aiPlain(q.q) + '」：' + (a == null ? '未作答' : a === q.a ? '答对' : '答错（选了「' + aiPlain(q.o[a]) + '」，正确是「' + aiPlain(q.o[q.a]) + '」）'); })), tip: '先读讲解，再做小测，全部答对算通过。' }; },
  feeCalc: () => { const amt = r2(FC.price * FC.qty), b = calcFee(FC.code, 'B', amt), sl = calcFee(FC.code, 'S', amt); return { name: '费用计算器', lines: [SEC[FC.code].name + ' 价格 ' + FC.price + ' × ' + FC.qty + '，成交额 ' + money(amt), '买入费用 ' + money(b.total) + '，卖出费用 ' + money(sl.total) + '，一个来回 ' + money(b.total + sl.total) + '（占 ' + fx((b.total + sl.total) / amt * 100, 3) + '%）', feeState()], tip: '买卖一个来回的费用率就是「保本涨幅」。小额交易容易触发最低 5 元佣金。' }; },
  auction: () => { const { best } = aucCalc(); return { name: '集合竞价演示', lines: ['买单 ' + AUC.buys.map(x => fx(x[0], 2) + '×' + x[1]).join('、'), '卖单 ' + AUC.sells.map(x => fx(x[0], 2) + '×' + x[1]).join('、'), '算出的开盘价 ' + fx(best.p, 2) + '，成交 ' + best.v + ' 手'], tip: '开盘价取「成交量最大」的价格；量相同时取未成交量最小的，再取离前收最近的。' }; },
  analysis: () => { const d = analysisData(); return { name: '账户分析 · 基准 ' + SEC[anBench].name, lines: [d.from + ' 起 ' + d.n + ' 个交易日', '累计 ' + fx(d.totR * 100, 2) + '%，基准 ' + fx(d.bTot * 100, 2) + '%，年化波动 ' + fx(d.vol * 100, 2) + '%，夏普 ' + fx(d.sharpe, 2) + '，最大回撤 ' + fx(d.mdd * 100, 2) + '%', 'Beta ' + fx(d.beta, 2) + '，年化 Alpha ' + fx(d.alpha * 100, 2) + '%，跟踪误差 ' + fx(d.te * 100, 2) + '%，信息比率 ' + fx(d.ir, 2) + '，t 值 ' + fx(d.tstat, 2)], tip: '每个指标点开都能看到公式和代入过程。样本太短时只学「怎么算」，别看结论。' }; },
  fees: () => ({ name: '费率与账户', lines: [feeState(), '规费' + (S.fee.regsSeparate ? '单列' : '含在佣金里') + '，' + (S.fee.mergeOrder ? '同一委托多笔成交合并计佣' : '每笔成交单独计佣')], tip: '佣金以你开户券商的为准，最可靠的办法是用真实交割单校准。' }),
  calibrate: () => ({ name: '交割单校准', lines: ['正在填写：' + SEC[CAL_IN.code].name + ' ' + (CAL_IN.side === 'B' ? '买入' : '卖出') + '，成交价 ' + (CAL_IN.price || '未填') + '，数量 ' + (CAL_IN.qty || '未填') + '，佣金 ' + (CAL_IN.commission || '未填'), feeState()], tip: '抄一条真实成交，App 按当前费率重算并逐项比对，不一致时反推你的佣金率。' }),
  me: () => ({ name: '我的', lines: ['总资产 ' + money(account().total) + '，净入金 ' + money(S.depositTotal), feeState()], tip: '账户、费率、AI 和数据源的设置都在这里。' })
};
function pageCtx(e) {
  if (!e) return null;
  try { if (PAGE_AI[e.name]) return PAGE_AI[e.name](e.p || {}); } catch (err) { /* 页面状态还没初始化（例如没打开过集合竞价演示），退回到标题 */ }
  const sc = SCREENS[e.name], t = typeof sc.title === 'function' ? sc.title(e.p || {}) : sc.title;
  return { name: aiPlain(t), lines: [], tip: '' };
}
// 浏览页面也算一条操作（连续停留在同一页面只记一次）
const _aiRender = render;
render = function (reset) {
  const a = $('#aicomp'); if (a) a.remove();
  const r = _aiRender(reset), c = cur();
  if (!AI_SCREENS.includes(c.name)) { const pc = pageCtx(c); if (pc) logAct('view', pc.name); }
  return r;
};

// ---------- 上下文组装 ----------
let aiCtx = null; // { entry: 打开 AI 时所在的页面 {name, p}, code }
const aiTok = s => Math.round(String(s).length * 0.8); // 原型粗估：中文约 0.6–1 token / 字
const kfmt = n => n >= 1000 ? fx(n / 1000, 1) + 'k' : String(n);
const actLine = a => (a.di !== S.di ? CAL[a.di].slice(5).replace('-', '/') + ' ' : '') + hms(a.t).slice(0, 5) + ' [' + ACT_KIND[a.kind] + '] ' + a.text;
const SYS_PROMPT = '你是 AShareSim 里的学习助手。用户用真实行情、真实规则和真实税费做 A 股模拟交易，目标是学会交易规则、为个人量化打基础。\n' +
  '1. 只做分析和讲解，不推荐买卖，不预测涨跌，不能下单。\n' +
  '2. 行情、财务、持仓、成交、费率等数字只能来自工具结果或下面的上下文，不要凭记忆编造。\n' +
  '3. 用户说「这个」「这里」「刚才那笔」时，先看 <page_context> 和 <recent_actions>。\n' +
  '4. 用户说出值得长期记住的背景、偏好、计划或约定时，调用 remember。App 里能直接查到的数据（持仓、成交、费率、行情）不要记。\n' +
  '5. 涉及规则时引用规则名称，能跳转规则课就给出课程。\n' +
  '6. 回答末尾附「仅供学习，不构成投资建议」。';
const AI_TOOLS = [
  ['get_quote(code)', '实时快照、五档、涨跌停价'], ['get_kline(code, period, adjust, n)', '分时 / 日 / 周 / 月 K'], ['get_company_profile(code)', 'F10 简况、主营构成'], ['get_financials(code, periods)', '利润表、资产负债表、现金流摘要'],
  ['get_positions()', '持仓、可卖、摊薄成本'], ['get_orders(date)', '委托和状态'], ['get_trades(range)', '成交和交割单'], ['get_fee_profile()', '当前费率和是否已校准'], ['get_rule(topic | code)', '规则规格和规则课'],
  ['get_activity(n, kinds)', '比上下文更早的操作记录'], ['search_conversations(query)', '检索其他对话的摘要'], ['remember(text, kind)', '写一条长期记忆（唯一的写工具，只写记忆，不碰账户）'], ['forget(id)', '删除一条记忆']
];
function newThreadObj() { return { id: ++seq, title: '', created: today(), updated: today(), msgs: [], summary: '', compacted: 0, lastPage: null }; }
function curThread() {
  let th = S.ai.threads.find(x => x.id === S.ai.cur);
  if (!th) { th = newThreadObj(); S.ai.threads.unshift(th); S.ai.cur = th.id; }
  return th;
}
// 记忆放在 system 里，一改就会让整个对话的缓存失效。所以每个对话在第一次发送时拍一个记忆快照，
// 对话中途新增 / 修改的记忆从下一个对话（或下一次压缩）开始进入 system；本对话里模型通过 remember 的工具结果已经知道。
const memNow = () => S.ai.cfg.memory === 'off' ? [] : S.ai.mem.map(m => ({ kind: m.kind, text: m.text }));
function buildCtx() {
  const cfg = S.ai.cfg, th = curThread();
  return { page: cfg.page && aiCtx ? pageCtx(aiCtx.entry) : null, acts: cfg.acts ? S.acts.slice(-cfg.acts) : [], mems: th.memSnap || memNow(), th, code: aiCtx ? aiCtx.code : null };
}
const memPending = th => th.memSnap ? JSON.stringify(th.memSnap) !== JSON.stringify(memNow()) : false;
// 已经发出去、留在历史里的 token：每条提问连同当时附带的页面和操作原样保留（只追加、不改写，缓存才能命中）
const histTokOf = th => th.histTok != null ? th.histTok : th.msgs.reduce((a, m) => a + (m.role === 'u' ? aiTok(m.text) + 300 : m.role === 'a' ? aiTok(m.text) : 0), 0);
function ctxCost(c) {
  const x = { sys: aiTok(SYS_PROMPT), tools: 760, mem: aiTok(c.mems.map(m => m.text).join('\n')), sum: aiTok(c.th.summary), hist: histTokOf(c.th), page: c.page ? aiTok(c.page.name + c.page.lines.join('\n')) : 0, acts: aiTok(c.acts.map(actLine).join('\n')) };
  x.total = x.sys + x.tools + x.mem + x.sum + x.hist + x.page + x.acts + 40;
  return x;
}

// ---------- 缓存：断点、命中估算、费用 ----------
// 断点 1：tools + 固定系统提示（所有对话共用）；断点 2：记忆快照 + 对话摘要（本对话内不变）；自动断点：对话末尾（随对话增长）
// 计费按 Anthropic 的语义模拟：读到上一次写入的最高位置，之后的部分按写入计；OpenAI 由服务端自动缓存，原型按同样方式估算
const CACHE_TTL_MS = 5 * 60 * 1000;
function cacheEstimate(c, q) {
  const x = ctxCost(c), svc = aiSvc(), th = c.th, now = Date.now();
  const fixed = x.sys + x.tools, stable = fixed + x.mem + x.sum, total = stable + x.hist + x.page + x.acts + aiTok(q || '') + 40;
  if (svc.cache === 'off') return { total, read: 0, write: 0, unc: total, fixed, stable };
  const p = th.lastReq, w = S.ai.warm;
  let read = 0;
  if (p && p.svc === svc.id && now - p.at < CACHE_TTL_MS && p.stable === stable) read = p.prefix;
  else if (w && w.svc === svc.id && now - w.at < CACHE_TTL_MS) read = w.fixed === fixed ? fixed : 0;
  if (total < 512) return { total, read: 0, write: 0, unc: total, fixed, stable }; // 低于最小可缓存长度时不缓存
  return { total, read, write: total - read, unc: 0, fixed, stable };
}
function priceOf(u, outTok) {
  const pr = aiSvc().price; if (!pr) return null;
  const cost = (u.read * pr.cr + u.write * pr.cw + u.unc * pr.in + outTok * pr.out) / 1e6, base = (u.total * pr.in + outTok * pr.out) / 1e6;
  return { cost, base };
}
function recordUsage(c, q, answer) {
  const svc = aiSvc(), th = c.th, u = cacheEstimate(c, q), out = aiTok(answer), pc = priceOf(u, out);
  th.lastReq = { at: Date.now(), svc: svc.id, prefix: u.total, stable: u.stable };
  S.ai.warm = { at: Date.now(), svc: svc.id, fixed: u.fixed };
  th.histTok = u.total - u.stable + out; // 历史 = 之前的历史 + 本轮提问（含附带内容）+ 回答
  const t = th.usage || (th.usage = { read: 0, write: 0, unc: 0, out: 0, cost: 0, base: 0, n: 0 });
  t.read += u.read; t.write += u.write; t.unc += u.unc; t.out += out; t.n++;
  if (pc) { t.cost += pc.cost; t.base += pc.base; }
  return { read: u.read, write: u.write, unc: u.unc, out, cost: pc && pc.cost, base: pc && pc.base };
}
const usd = v => '$' + (v < 0.01 ? v.toFixed(4) : v.toFixed(3));
const usageLine = u => '缓存读 ' + kfmt(u.read) + ' · 写 ' + kfmt(u.write) + (u.unc ? ' · 未缓存 ' + kfmt(u.unc) : '') + ' · 输出 ' + kfmt(u.out) + (u.cost != null ? ' · ≈ ' + usd(u.cost) + '（不用缓存 ' + usd(u.base) + '）' : '');
const ctxSummary = c => [c.page && c.page.name, c.acts.length && '最近 ' + c.acts.length + ' 条操作', c.mems.length && c.mems.length + ' 条记忆', c.th.summary && '对话摘要'].filter(Boolean).join(' · ');
// 实际请求的样子：固定的部分在前（命中提示词缓存），每次都变的页面和操作放在最后一条用户消息
function reqPreview(c) {
  const svc = aiSvc(), memTxt = c.mems.map(m => '- [' + m.kind + '] ' + m.text).join('\\n'), on = svc.cache !== 'off';
  const vol = (c.page ? '<page_context>\\n' + c.page.name + '\\n' + c.page.lines.map(l => '- ' + l).join('\\n') + '\\n</page_context>\\n' : '') + (c.acts.length ? '<recent_actions>\\n' + c.acts.map(a => '- ' + actLine(a)).join('\\n') + '\\n</recent_actions>' : '');
  const cut = s => s.length > 220 ? s.slice(0, 220) + '…' : s;
  const hist = c.th.msgs.filter(m => m.role === 'u' || m.role === 'a').slice(-4);
  const sumTxt = c.th.summary ? '\\n<conversation_summary>…</conversation_summary>' : '';
  const histL = hist.map(m => '    { "role": "' + (m.role === 'u' ? 'user' : 'assistant') + '", "content": "' + cut(m.text.replace(/\n/g, '\\n')).slice(0, 36) + '…" },\n').join('');
  if (svc.protocol === 'messages') return 'POST ' + svc.base + '/v1/messages\nanthropic-version: 2023-06-01\n{\n  "model": "' + svc.model + '",\n  "max_tokens": 16000,\n  "thinking": { "type": "adaptive" },\n  "output_config": { "effort": "low" },   // 按服务固定，中途改会让缓存失效\n' +
    (on ? '  "cache_control": { "type": "ephemeral" },   // 自动断点：落在最后一块，随对话后移\n' : '') +
    '  "tools": [ /* ' + AI_TOOLS.length + ' 个工具，按名字排序，任何设置下都不增减 */ ],\n  "system": [\n    { "type": "text", "text": "<固定系统提示>"' + (on ? ',\n      "cache_control": { "type": "ephemeral" } },   // 断点 1：tools + 系统提示，所有对话共用' : ' },') + '\n    { "type": "text", "text": "<memory>\\n' + cut(memTxt) + '\\n</memory>' + sumTxt + '"' + (on ? ',\n      "cache_control": { "type": "ephemeral" } }    // 断点 2：记忆快照 + 摘要，本对话内不变' : ' }') + '\n  ],\n  "messages": [\n' + histL +
    '    { "role": "user", "content": [\n      { "type": "text", "text": "' + cut(vol) + '" },\n      { "type": "text", "text": "<你的问题>" } ] }\n  ]\n}\n\n// 响应 usage：input_tokens（未缓存）/ cache_creation_input_tokens（写）/ cache_read_input_tokens（读）';
  return 'POST ' + svc.base + '/v1/responses\n{\n  "model": "' + svc.model + '",\n  "store": false,\n' +
    (on ? '  "prompt_cache_key": "asharesim-' + (hashStr('install') % 1e6).toString(36) + '",   // 每台设备固定一个，同前缀的请求路由到同一缓存\n  // GPT-5.6 起默认 prompt_cache_options = { "mode": "implicit", "ttl": "30m" }，不必发送\n' : '') +
    '  "reasoning": { "effort": "low" },   // 按服务固定\n  "tools": [ /* ' + AI_TOOLS.length + ' 个 function，按名字排序，任何设置下都不增减 */ ],\n  "instructions": "<固定系统提示>\\n<memory>\\n' + cut(memTxt) + '\\n</memory>' + sumTxt + '",\n  "input": [\n' + histL +
    '    { "role": "user", "content": [\n      { "type": "input_text", "text": "' + cut(vol) + '" },\n      { "type": "input_text", "text": "<你的问题>" } ] }\n  ]\n}\n\n// 响应 usage：input_tokens_details.cached_tokens（读）/ cache_write_tokens（写，GPT-5.6 起）';
}

// ---------- 打开 AI、对话管理 ----------
function openAI(intent, code) {
  const c = cur();
  if (!AI_SCREENS.includes(c.name)) {
    const ctxCode = code || (c.p && c.p.code) || null;
    aiCtx = { entry: { name: c.name, p: Object.assign({}, c.p) }, code: ctxCode && SEC[ctxCode] && SEC[ctxCode].board !== 'index' ? ctxCode : null };
  } else if (code && aiCtx) aiCtx.code = code;
  const th = curThread(), pc = aiCtx ? pageCtx(aiCtx.entry) : null, pn = pc ? pc.name : null;
  if (pn && th.lastPage !== pn) { if (th.msgs.length) th.msgs.push({ role: 'ctx', text: pn }); th.lastPage = pn; }
  R.stack = R.stack.filter(e => !AI_SCREENS.includes(e.name));
  go('ai', { intent });
}
function openThread(id) { S.ai.cur = id; openAI(); }
function newThread() {
  const th = curThread();
  if (th.msgs.length || th.summary) { const n = newThreadObj(); S.ai.threads.unshift(n); S.ai.cur = n.id; }
  if (aiBusy) aiBusy = false;
  openThread(S.ai.cur);
}
function delThread(id) {
  const t = S.ai.threads.find(x => x.id === id);
  modal({ title: '删除对话', body: '<div class="ink2" style="font-size:13px">删除「' + esc(t.title || '新对话') + '」的全部消息和摘要。从这个对话里记住的事不会删除，可以在「AI 记忆」里单独管理。</div>', ok: '删除', onOk: () => { S.ai.threads = S.ai.threads.filter(x => x.id !== id); if (S.ai.cur === id) S.ai.cur = 0; refresh(); } });
}
function addMem(text, kind, th) {
  const m = { id: ++seq, kind, text, src: th ? '对话「' + (th.title || '新对话') + '」' : '手动添加', date: today(), th: th ? th.id : null };
  S.ai.mem.unshift(m); return m.id;
}
function memUndo(id) { S.ai.mem = S.ai.mem.filter(m => m.id !== id); showToast('已撤销这条记忆'); refresh(); }
function memAccept(i, yes) {
  const th = curThread(), m = th.msgs[i];
  if (yes) m.memIds = [addMem(m.memAsk.text, m.memAsk.kind, th)];
  else m.memNo = true;
  m.memAsk = null; refresh();
}
// 对话太长时，把较早的消息压缩成摘要，只保留最近 8 条原文（真实 App 由模型生成摘要）
function maybeCompact(th) {
  const isMsg = m => m.role === 'u' || m.role === 'a';
  if (th.msgs.filter(isMsg).length <= S.ai.cfg.compactAfter) return;
  let keep = 0, n = 0;
  for (let i = th.msgs.length - 1; i >= 0; i--) if (isMsg(th.msgs[i]) && ++n === 8) { keep = i; break; }
  while (keep > 0 && th.msgs[keep].role !== 'u') keep--;
  const old = th.msgs.slice(0, keep), qs = old.filter(m => m.role === 'u').map(m => '「' + (m.text.length > 14 ? m.text.slice(0, 14) + '…' : m.text) + '」');
  const folded = old.filter(isMsg).length;
  th.summary = (th.summary ? th.summary + '\n' : '') + today().slice(5).replace('-', '/') + ' 你说了或问了' + qs.join('、') + '。';
  th.compacted += folded; th.msgs = th.msgs.slice(keep);
  // 压缩会改写历史，缓存本来就要重建一次：趁这次把记忆快照也刷新
  th.memSnap = null; th.histTok = null; th.lastReq = null;
  showToast('对话较长，较早的 ' + folded + ' 条消息已压缩成摘要', 'info');
}

// ---------- AI 页面 ----------
SCREENS.ai = {
  title: () => 'AI 助手<span class="sub">' + (s => s.name + ' · ' + protoName(s.protocol) + ' · ' + s.model)(aiSvc()) + '</span>',
  fab: false,
  navRight: () => '<span style="display:flex"><button class="ib" style="width:34px" onclick="newThread()" aria-label="新对话">＋</button><button class="ib" style="width:34px" onclick="go(\'aiThreads\')" aria-label="对话与记忆">☰</button></span>',
  render() {
    const c = buildCtx(), th = c.th;
    let h = '<div class="ctx" onclick="go(\'aiCtx\')"><span class="muted">上下文</span>' + (c.page ? '<span class="c">' + esc(c.page.name) + '</span>' : '<span class="c off">页面已关闭</span>') + '<span class="c2">操作 ' + c.acts.length + '</span><span class="c2">记忆 ' + c.mems.length + '</span><span style="flex:1"></span><span class="muted">查看 ›</span></div>';
    h += '<div class="chat" id="chat">';
    if (th.summary) h += '<div class="sumbox"><b>较早的 ' + th.compacted + ' 条消息已压缩成摘要</b>' + esc(th.summary) + '</div>';
    if (!th.msgs.length && !th.summary) h += '<div class="empty" style="padding:28px 16px">新对话。<br>我能看到你正在看的页面和最近的操作，可以直接问「这是什么意思」「刚才那笔为什么是废单」。<br>' + (c.mems.length ? '我还记得你告诉过我的 ' + c.mems.length + ' 件事，在 ☰ →「AI 记忆」里可以查看和修改。' : '') + '</div>';
    th.msgs.forEach((m, i) => { h += msgHTML(m, i); });
    return h + '</div>';
  },
  after(p) {
    const old = $('#aicomp'); if (old) old.remove();
    const c = buildCtx(), x = ctxCost(c), est = cacheEstimate(c, ''), chips = aiChips(c);
    $('#tabbar').insertAdjacentHTML('beforebegin', '<div id="aicomp"><div class="chips">' + chips.map(([k, l]) => '<button onclick="aiAsk(\'' + k + '\',\'' + l.replace(/'/g, '') + '\')">' + esc(l) + '</button>').join('') + '</div><div class="composer"><input id="aiin" placeholder="问问题，或者告诉我「我打算……」" onkeydown="if(event.key===\'Enter\')aiFree()"><button class="btn buy sm" onclick="aiFree()">发送</button></div><div class="muted" style="font-size:10px;padding:0 12px 6px;background:#fff">本次约 ' + kfmt(x.total) + ' tokens，预计 ' + kfmt(est.read) + ' 走缓存' + (est.read ? '' : '（' + (aiSvc().cache === 'off' ? '缓存已关闭' : '缓存是冷的，这次写入') + '）') + ' · 原型为本地示例回复，不联网</div></div>');
    const v = $('#view'); v.scrollTop = v.scrollHeight;
    if (p.intent && !p.asked) { p.asked = true; const ch = chips.find(x => x[0] === p.intent); if (ch) aiAsk(ch[0], ch[1]); }
  }
};
function msgHTML(m, i) {
  if (m.role === 'ctx') return '<div class="ctxdiv"><span>你现在在：' + esc(m.text) + '</span></div>';
  if (m.role === 'steps') return '<div class="steps">' + m.items.map(x => '<span>' + esc(x) + '</span>').join('') + '</div>';
  if (m.role === 'u') return '<div class="msg u"><span class="tx">' + esc(m.text) + '</span></div>' + (m.ctx ? '<div class="uctx" onclick="go(\'aiCtx\')">附带：' + esc(m.ctx) + '</div>' : '');
  let h = '<div class="msg a"><span class="tx">' + esc(m.text) + '</span>';
  if (m.done) {
    if (m.links && m.links.length) h += '<span class="mlinks">' + m.links.map((l, k) => '<button onclick="aiLink(' + i + ',' + k + ')">' + esc(l[0]) + '</button>').join('') + '</span>';
    (m.memIds || []).forEach(id => { const mm = S.ai.mem.find(x => x.id === id); h += mm ? '<span class="memnote">已记住：' + esc(mm.text) + '<button onclick="memUndo(' + id + ')">撤销</button></span>' : '<span class="memnote off">这条记忆已删除</span>'; });
    if (m.memAsk) h += '<span class="memnote">要记住「' + esc(m.memAsk.text) + '」吗？<button onclick="memAccept(' + i + ',true)">记住</button><button onclick="memAccept(' + i + ',false)">不用</button></span>';
    if (m.memNo) h += '<span class="memnote off">没有记住</span>';
  }
  return h + (m.noDisc ? '' : '<span class="disc">仅供学习，不构成投资建议</span>') + (m.usage && m.done ? '<span class="usage">' + usageLine(m.usage) + '</span>' : '') + '</div>';
}
function aiLink(i, k) { const m = curThread().msgs[i]; if (m && m.links && m.links[k]) m.links[k][1](); }

// ---------- 快捷问题：根据页面和最近操作变化 ----------
function lastOp() { for (let i = S.acts.length - 1; i >= 0; i--) { const a = S.acts[i]; if (!['view', 'export', 'setting'].includes(a.kind)) return a; } return null; }
const RECENT_Q = {
  reject: a => /废单/.test(a.text) ? '刚才那笔为什么是废单？' : '刚才为什么下不了单？',
  fill: () => '解释刚才这笔成交', order: () => '刚才那笔委托什么时候能成交？', cancel: () => '撤单之后钱和股票怎么变？',
  transfer: () => '转账之后可用和可取有什么区别？', system: () => '刚才清算做了什么？',
  learn: a => /答错/.test(a.text) ? '我刚才那道题错在哪？' : /校准/.test(a.text) ? '校准结果怎么看？' : null
};
function aiChips(c) {
  const out = [], last = lastOp(), q = last && RECENT_Q[last.kind] && RECENT_Q[last.kind](last);
  if (q) out.push(['recent', q]);
  if (c.page) out.push(['page', '解释这个页面']);
  if (c.code) out.push(['company', '介绍这家公司'], ['trend', '近 3 个月走势怎么看'], ['rule', '这只股票的交易规则']);
  out.push(['recall', '我们上次聊了什么？'], ['review', '复盘我今天的交易'], ['fee', '解释最近一笔交割单的费用'], ['analysis', '解释我的账户分析']);
  return out;
}

// ---------- 发送 ----------
function memDetect(v) {
  const tidy = s => s.replace(/^我/, '').replace(/[。！!]+$/, '').trim();
  if (/[？?]$|吗|是不是|该不该|要不要|能不能|怎么/.test(v)) return null;
  let m = v.match(/^(?:请|帮我)?(?:记住|记一下)[:：，,\s]*(.+)$/);
  if (m) return { text: tidy(m[1]), kind: '约定' };
  if (/^我(打算|计划|准备|每个?月|每周|以后|下周|明年)/.test(v)) return { text: tidy(v), kind: '计划' };
  if (/^我(不想|不会|不做|只做|只买|偏好|喜欢|习惯|更看重|比较保守|风险承受|能接受)/.test(v)) return { text: tidy(v), kind: '偏好' };
  if (/^我(是|在|做|从事|有)/.test(v) && v.length < 60) return { text: tidy(v), kind: '背景' };
  return null;
}
function feeStmt(v) {
  if (!/佣金|费率|免五|免5/.test(v) || /[？?]$|吗|多少|怎么/.test(v)) return null;
  const r = v.match(/万\s*([0-9.]+)/), mian5 = /免五|免5/.test(v) && !/不免/.test(v);
  return { rate: r ? parseFloat(r[1]) : null, mian5 };
}
function aiFree() {
  const el = $('#aiin'), v = el.value.trim(); if (!v) return;
  const fs = feeStmt(v), mm = fs ? null : memDetect(v);
  const k = fs ? 'feeset' : mm ? 'remember' : /刚才|刚刚|那笔|那一笔|为什么.*(废单|下不了|没成交|被拒|拦)/.test(v) ? 'recent' : /这个页面|这页|这些数|这里|这是什么|看不懂/.test(v) ? 'page' : /上次|之前.*(问|聊|说)|还记得|我说过/.test(v) ? 'recall' :
    /费|佣金|印花/.test(v) ? 'fee' : /规则|涨停|T\+1|笼子/.test(v) ? 'rule' : /公司|介绍|主营/.test(v) ? 'company' : /走势|技术|均线/.test(v) ? 'trend' : /市盈率|PE/.test(v) ? 'pe' : 'general';
  aiAsk(k, v, fs || mm);
}
let aiBusy = false;
function aiAsk(kind, text, extra) {
  if (aiBusy) return showToast('上一个问题还在回答');
  aiBusy = true;
  const c = buildCtx(), th = c.th;
  if (!th.title) th.title = text.length > 16 ? text.slice(0, 16) + '…' : text;
  th.updated = today();
  if (!th.memSnap) { th.memSnap = memNow(); c.mems = th.memSnap; }
  const r = aiAnswer(kind, c, text, extra), usage = recordUsage(c, text, r.answer);
  th.msgs.push({ role: 'u', text, ctx: ctxSummary(c) });
  const st = { role: 'steps', items: [] };
  if (r.steps.length) th.msgs.push(st);
  refresh();
  let i = 0;
  const finish = m => { m.text = r.answer; m.done = true; m.usage = usage; aiBusy = false; maybeCompact(th); if (cur().name === 'ai') refresh(); };
  const next = () => {
    if (cur().name !== 'ai' || S.ai.cur !== th.id) { const m = { role: 'a', text: '', links: r.links, memIds: r.memIds, memAsk: r.memAsk, noDisc: r.noDisc }; st.items = r.steps.slice(); th.msgs.push(m); return finish(m); }
    if (i < r.steps.length) { st.items.push(r.steps[i++]); refresh(); setTimeout(next, 380); return; }
    const m = { role: 'a', text: '', links: r.links, memIds: r.memIds, memAsk: r.memAsk, noDisc: r.noDisc }; th.msgs.push(m);
    let j = 0;
    const type = () => {
      if (cur().name !== 'ai' || j >= r.answer.length) return finish(m);
      j = Math.min(r.answer.length, j + 6); m.text = r.answer.slice(0, j);
      const el = $('#chat'); if (el) { el.lastElementChild.querySelector('.tx').textContent = m.text; $('#view').scrollTop = 1e6; } else refresh();
      setTimeout(type, 16);
    };
    refresh(); type();
  };
  setTimeout(next, 300);
}

// ---------- 示例回答（真实 App 由模型生成；这里演示「用了哪些上下文」） ----------
const memFor = (c, code, kinds) => c.mems.filter(m => (code && m.text.includes(SEC[code].name)) || (kinds && kinds.includes(m.kind)));
const memTail = ms => ms.length ? '\n\n结合你之前说过的：\n' + ms.map(m => '· ' + m.text).join('\n') : '';
const calibLink = () => feeCalibrated() ? [] : [['用真实交割单校准费率', () => go('calibrate')]];
function aiAnswer(kind, c, text, extra) {
  const code = c.code, s = code ? SEC[code] : null;
  if (kind === 'feeset') {
    const f = extra, links = [];
    let ans = '收到。App 现在的' + feeState() + '。';
    if (f.rate) {
      links.push(['把费率改成万 ' + f.rate + (f.mian5 ? '、免五' : ''), () => { S.fee.rate = f.rate / 1e4; S.fee.mian5 = f.mian5; logAct('setting', '按 AI 对话修改费率：股票万 ' + f.rate + (f.mian5 ? '，免五' : '')); showToast('费率已更新，仍建议用交割单校准'); refresh(); }]);
      ans += '\n\n费率属于 App 设置，我不把它存成「记忆」：设置里改一次，下单、交割单和我的回答都会用同一个数。点下面的按钮可以直接改。';
    } else ans += '\n\n你没说具体是万几。';
    ans += '\n\n最准的办法还是用真实交割单校准：抄一条你券商 App 里的成交，App 会反推佣金率、判断是否免五。';
    return { steps: ['get_fee_profile()'], answer: ans, links: links.concat([['去交割单校准', () => go('calibrate')]]), noDisc: true };
  }
  if (kind === 'remember') {
    const mode = S.ai.cfg.memory, th = c.th;
    const r = { steps: [], answer: '明白了，之后回答时我会考虑这一点。', links: [], noDisc: true };
    if (mode === 'off') r.answer += '\n\n（长期记忆已关闭，这条只在当前对话里有效。）';
    else if (mode === 'confirm') r.memAsk = extra;
    else { r.steps = ['remember("' + extra.text + '", ' + extra.kind + ')']; r.memIds = [addMem(extra.text, extra.kind, th)]; }
    if (extra.kind === '计划' && /定投|每个?月/.test(text)) r.answer += '\n\n定投这类计划可以在「学习 → 模拟执行」里写成调仓清单，App 会按真实规则生成集合竞价预埋单。';
    if (mode !== 'off') r.answer += '\n\n记忆跨对话有效，可以在 ☰ →「AI 记忆」里查看、修改或删除。';
    if (/定投|每个?月/.test(text)) r.links.push(['去模拟执行', () => go('exec')]);
    return r;
  }
  if (kind === 'page') {
    const pg = c.page;
    if (!pg) return { steps: [], answer: '页面上下文已关闭，我看不到你在哪个页面。可以在「上下文设置」里打开。', links: [['上下文设置', () => go('aiCtx')]], noDisc: true };
    const bad = pg.lines.find(l => /校验不通过/.test(l));
    return { steps: ['读取页面上下文：' + pg.name], answer: '你现在在「' + pg.name + '」。我看到的是：\n' + pg.lines.map(l => '· ' + l).join('\n') + (pg.tip ? '\n\n' + pg.tip : '') + (bad ? '\n\n现在提交会被拦下：' + bad.replace('表单校验不通过：', '') + ' 先改这一项。' : ''),
      links: (pg.lines.some(l => /还没有用真实交割单校准/.test(l)) ? calibLink() : []) };
  }
  if (kind === 'recent') return recentAnswer(c);
  if (kind === 'recall') {
    const others = S.ai.threads.filter(t => t.id !== c.th.id && (t.msgs.length || t.summary));
    const hit = STOCKS.map(x => SEC[x].name).filter(n => text.includes(n));
    const all = t => t.title + t.summary + t.msgs.map(m => m.text || '').join('');
    const list = hit.length ? others.filter(t => hit.some(n => all(t).includes(n))) : others;
    const brief = t => t.summary || t.msgs.filter(m => m.role === 'u').map(m => '「' + m.text.slice(0, 14) + '」').join('、');
    return { steps: ['search_conversations("' + (hit[0] || '最近') + '")'],
      answer: (list.length ? '本机保存的其他对话里' + (hit.length ? '，提到' + hit.join('、') + '的有：' : '，最近的是：') + list.slice(0, 3).map(t => '\n· ' + t.created.slice(5).replace('-', '/') + '「' + t.title + '」：' + brief(t)).join('') : '没有找到相关的历史对话。') +
        (S.ai.mem.length ? '\n\n我长期记住的：\n' + S.ai.mem.map(m => '· [' + m.kind + '] ' + m.text).join('\n') : '') +
        '\n\n说明：别的对话原文不会自动带进来，我是检索它们的摘要找到的。需要细节可以打开那个对话接着聊。',
      links: list.slice(0, 2).map(t => ['打开「' + t.title + '」', () => openThread(t.id)]), noDisc: true };
  }
  if (kind === 'company' && s) {
    const q = DATA.quotes[code], sn = snap(code, S.t);
    return { steps: ['get_company_profile(' + s.sym + ')', 'get_quote(' + s.sym + ')', 'get_financials(' + s.sym + ', 最近 4 期)'],
      answer: (PROFILE[code] || s.fullName + '：原型没有内置这家公司的资料，真实 App 会读取 F10。') + '\n\n几个关键数字（' + hms(S.t) + '）：\n· 现价 ' + px(code, sn.price) + '，' + pctS(sn.pct) + '\n' + (s.board === 'etf' ? '· 这是基金，没有市盈率；关注跟踪误差、规模和管理费。\n' : '· 市盈率（动）约 ' + fx(q.pe, 1) + '，市净率 ' + fx(q.pb, 2) + '\n· 总市值约 ' + fx(q.totalCap, 0) + ' 亿元\n') + '· 52 周区间 ' + px(code, q.w52l) + ' – ' + px(code, q.w52h) + '\n· ' + posLine(code) + '\n\n要深入了解，建议按这个顺序看：主营构成（钱从哪来）→ 近 3 年营收和净利润增速 → 毛利率和现金流 → 估值和同行对比。' + memTail(memFor(c, code)) };
  }
  if (kind === 'trend' && s) {
    const k = liveBars(code), n = k.length, cl = k[n - 1][2];
    const ch = d => (cl / k[n - 1 - d][2] - 1) * 100, ma = d => k.slice(n - d).reduce((a, r) => a + r[2], 0) / d;
    const hi = Math.max(...k.slice(n - 60).map(r => r[3])), lo = Math.min(...k.slice(n - 60).map(r => r[4]));
    const v5 = k.slice(n - 5).reduce((a, r) => a + r[5], 0) / 5, v20 = k.slice(n - 20).reduce((a, r) => a + r[5], 0) / 20;
    const ms = memFor(c, code), stop = ms.some(m => /止损/.test(m.text)), pos = positions().find(x => x.code === code);
    return { steps: ['get_kline(' + s.sym + ', 日线, 前复权, 120 根)', '计算 MA20 / MA60、区间涨跌、量能'],
      answer: s.name + ' 近期表现（前复权）：\n· 近 20 日 ' + pctS(ch(20)) + '，近 60 日 ' + pctS(ch(60)) + '\n· 现价 ' + px(code, cl) + '，MA20 ' + px(code, ma(20)) + '，MA60 ' + px(code, ma(60)) + '，价格在 MA20 ' + (cl > ma(20) ? '上方' : '下方') + '、MA60 ' + (cl > ma(60) ? '上方' : '下方') + '\n· 近 60 日区间 ' + px(code, lo) + ' – ' + px(code, hi) + '，现价处在区间 ' + fx((cl - lo) / (hi - lo) * 100, 0) + '% 的位置\n· 近 5 日平均成交量是近 20 日的 ' + fx(v5 / v20, 2) + ' 倍\n\n均线和区间位置只描述「过去发生了什么」，不能预测未来。路线图阶段 4 会教你用 IC 检验这类信号有没有预测力，在那之前别把它当买卖依据。' + memTail(ms) +
        (stop && pos ? '\n\n你说过止损规则还没定。现在相对你的摊薄成本 ' + pctS(pos.pnlPct) + '，可以趁现在把规则写下来，比如「收盘价跌破成本 8% 卖出」，写进「模拟执行 → 交易纪律」。' : ''),
      links: stop ? [['去写交易纪律', () => go('exec')]] : [] };
  }
  if (kind === 'rule' && s) {
    const m = MK[code], a = availableQty(code);
    return { steps: ['get_rule(' + s.sym + ')', 'get_positions(' + s.sym + ')'],
      answer: s.name + ' 属于' + BOARD_NAME[s.board] + (s.st ? '（风险警示）' : '') + '：\n· 涨跌幅 ±' + s.limitPct * 100 + '%，今天 ' + px(code, m.down) + ' – ' + px(code, m.up) + '\n· ' + (s.board === 'kcb' ? '一次至少买 200 股，之后可以 1 股递增' : '买入以 100 ' + unitName(code) + '为单位') + '\n· 连续竞价时有价格笼子' + (s.board === 'kcb' ? '（只有 2%）' : '（2% 或 0.1 元取较宽者）') + '\n· T+1：今天买的明天才能卖' + (a.held ? '。你持有 ' + intf(a.held) + '，现在可卖 ' + intf(a.sellable) : '') + '\n· 费用：' + (s.board === 'etf' ? '只有佣金' : '佣金 + 过户费，卖出另收 0.05% 印花税'),
      links: [['规则课：价格笼子', () => go('lesson', { id: 'cage' })], ['规则课：T+1', () => go('lesson', { id: 't1' })]] };
  }
  if (kind === 'fee') {
    const l = S.ledger.find(x => x.biz === '证券买入' || x.biz === '证券卖出');
    if (!l) return { steps: ['get_trades(最近 1 笔)'], answer: '还没有成交记录。' };
    return { steps: ['get_trades(最近 1 笔)', 'get_fee_profile()'], answer: feeExplain(l.code, l.biz === '证券买入' ? 'B' : 'S', l.date, l.name, l.qty, l.price, l.amount, l), links: calibLink() };
  }
  if (kind === 'review') {
    const os = S.orders.filter(o => o.di === S.di), ms = memFor(c, null, ['计划', '偏好']);
    return { steps: ['get_orders(今天)', 'get_trades(今天)', 'get_activity(今天)'],
      answer: '今天共 ' + os.length + ' 笔委托：\n' + os.map(o => '· ' + ordLine(o)).join('\n') + '\n\n值得注意：' + (os.some(o => o.status === '废单') ? '有废单，原因是价格超出了价格笼子。卖出时挂得比买一低 2% 以上会被交易所拒绝，想快速卖出可以直接挂买一价。' : '没有废单。') + (os.some(isLive) ? '\n还有未成交的挂单，收盘后会被系统撤销。' : '') +
        (ms.length ? '\n\n对照你说过的：\n' + ms.map(m => '· ' + m.text).join('\n') + (os.length >= 4 ? '\n今天下了 ' + os.length + ' 笔委托，比「先学规则、不做短线」的节奏频繁，可以想想每一笔是为了练什么。' : '\n今天的节奏和这些计划是一致的。') : '') };
  }
  if (kind === 'analysis') {
    const d = analysisData();
    return { steps: ['get_equity_history()', 'get_kline(沪深300)', '计算 beta / alpha / 跟踪误差'],
      answer: '从 ' + d.from + ' 到今天（' + d.n + ' 个交易日）：\n· 你的账户 ' + fx(d.totR * 100, 2) + '%，沪深300 ' + fx(d.bTot * 100, 2) + '%\n· Beta ' + fx(d.beta, 2) + '：大盘涨 1%，你的账户平均跟着动 ' + fx(d.beta, 2) + '%\n· 年化 Alpha ' + fx(d.alpha * 100, 2) + '%，跟踪误差 ' + fx(d.te * 100, 2) + '%，信息比率 ' + fx(d.ir, 2) + '\n· 超额的 t 值 ' + fx(d.tstat, 2) + (Math.abs(d.tstat) < 2 ? '，小于 2，统计上不能说明跑赢或跑输是能力而不是运气。' : '，但样本太短，仍然不足以下结论。') + '\n\n你的收益可以拆成「Beta × 基准收益」加「Alpha」，阶段 2 的通关标准就是能自己算出这几个数。' + memTail(memFor(c, null, ['偏好'])) };
  }
  if (kind === 'pe') return { steps: ['get_rule(估值指标)'], answer: '市盈率（PE）= 股价 ÷ 每股收益，表示按现在的利润，多少年能「赚回」市值。\n· 静态 PE 用上一年年报利润，动态 PE 用最新季报年化，TTM 用最近四个季度。\n· 银行股 PE 常在 5 倍左右，消费、科技股常在 20–50 倍，不同行业不能直接比。\n· 亏损公司 PE 为负，没有意义，改看市销率或市净率。' };
  return { steps: [], answer: '原型只内置了几类示例回答。真实 App 会把你的问题，连同上面「附带」的页面、最近操作和记忆一起发给你配置的模型，模型再通过只读工具查行情和账户数据后回答。' };
}
function feeExplain(code, side, date, name, qty, price, amount, l) {
  const ss = SEC[code], rate = ss.board === 'etf' ? S.fee.etfRate : S.fee.rate;
  return date + ' ' + (side === 'B' ? '买入' : '卖出') + ' ' + name + ' ' + intf(qty) + ' @ ' + px(code, price) + '，成交金额 ' + money(amount) + '：\n· 佣金 ' + money(l.commission) + '：金额 × 万' + (rate * 1e4).toFixed(2) + ' = ' + money(amount * rate) + (l.commission > amount * rate + 0.01 ? '，不足 5 元按 5 元收' : '') + '\n· 印花税 ' + money(l.stamp) + (side === 'B' ? '：买入不收' : '：卖出收 0.05%') + '\n· 过户费 ' + money(l.transfer) + (ss.board === 'etf' ? '：ETF 免收' : '：0.001%，买卖都收') + '\n· 经手费和证管费含在佣金里\n合计 ' + money(l.total) + ' 元，占成交额 ' + fx(l.total / amount * 100, 3) + '%。' + (feeCalibrated() ? '' : '\n\n注意：你的费率还没用真实交割单校准，佣金是按占位默认值算的，可能和你券商的不一样。');
}
function recentAnswer(c) {
  const a = lastOp(), when = a ? hms(a.t).slice(0, 5) : '';
  const steps = ['读取最近操作：' + c.acts.length + ' 条'];
  if (!a) return { steps, answer: '今天还没有下单、撤单、成交或转账。' };
  const o = a.ref && a.ref.order ? S.orders.find(x => x.id === a.ref.order) : null;
  if (a.kind === 'reject' && o && /价格笼子/.test(o.reason) && o.di === S.di) {
    const sn = snap(o.code, o.t), cg = cageRange(o.code, o.side, sn), isB = o.side === 'B';
    return { steps: steps.concat(['get_orders(' + o.no + ')', 'get_rule(价格笼子)']),
      answer: '你 ' + when + ' 委托' + ordText(o) + '，成了废单。\n\n原因是价格笼子：连续竞价时，' + (isB ? '买入价不能高于「卖一价的 102%」和「卖一价 + 10 个价位」中更高的那个' : '卖出价不能低于「买一价的 98%」和「买一价 − 10 个价位」中更低的那个') + '。当时' + (isB ? '卖一 ' : '买一 ') + px(o.code, cg.base) + '，' + (isB ? '上限是 ' + px(o.code, cg.max) : '下限是 ' + px(o.code, cg.min)) + '，你的 ' + px(o.code, o.price) + ' 超出了范围，交易所直接拒绝，不会排队。\n\n' + (isB ? '想尽快买入，挂卖一价或稍高一点（不超过上限）。' : '想尽快卖出，挂买一价或稍低一点（不低于下限），或者用「对手方最优」这类市价委托。') + '\n废单不冻结资金和股份，也不收任何费用。',
      links: [['规则课：价格笼子', () => go('lesson', { id: 'cage' })], ['看这笔委托', () => go('orderDetail', { id: o.id })]] };
  }
  if (a.kind === 'reject') {
    const r = a.ref || {};
    return { steps: steps.concat(['get_rule(' + (r.rule || '下单校验') + ')']), answer: '你 ' + when + ' 的下单在提交前被 App 拦下了。\n\n规则：' + (r.rule || '') + '\n' + (r.msg || a.text) + '\n\n这类错误真实券商也会直接拒绝，不会生成委托。', links: r.lesson ? [['看相关规则课', () => go('lesson', { id: r.lesson })]] : [] };
  }
  if (a.kind === 'fill') {
    const f = S.fills.find(x => x.id === a.ref.fill), ss = SEC[f.code];
    return { steps: steps.concat(['get_trades(' + f.no + ')', 'get_fee_profile()']), answer: '成交依据：' + f.basis + '\n\n' + feeExplain(f.code, f.side, CAL[f.di], ss.name, f.qty, f.price, f.amount, f.fee) + (f.side === 'B' ? '\n\n今天买入的' + (ss.board === 'etf' ? '份额' : '股票') + '要到下一交易日才能卖（T+1）。' : '\n\n卖出的钱今天就能用来买别的，下一交易日才能转出（可取）。'),
      links: [['看成交详情', () => go('fillDetail', { id: f.id })]].concat(calibLink()) };
  }
  if (a.kind === 'order' && o) {
    const sn = snap(o.code, S.t), isB = o.side === 'B';
    let ans = '你 ' + when + ' 委托' + ordText(o) + '，现在是「' + o.status + '」。';
    if (o.status === '已成') ans += '\n已经全部成交，均价 ' + px(o.code, o.amt / o.filled) + '。';
    else if (!isLive(o)) ans += (o.reason ? '\n' + o.reason : '');
    else if (o.status === '未报' || o.inAuction) ans += '\n' + (o.note || '') + '。';
    else {
      const opp = isB ? sn.asks[0] : sn.bids[0];
      ans += '\n这是限价单，' + (isB ? '只有卖方愿意以 ' + px(o.code, o.price) + ' 或更低的价格卖' : '只有买方愿意以 ' + px(o.code, o.price) + ' 或更高的价格买') + '才会成交。现在' + (isB ? '卖一 ' : '买一 ') + (opp ? px(o.code, opp[0]) : '--') + '，' + (o.queue ? '按盘口估计，同价位排在你前面的还有约 ' + intf(o.queue) + ' 股，要先成交完才轮到你。' : '你的价格还没碰到对手盘。') + '\n今天收盘前没成交的部分会在清算时由系统撤销（当日有效）。想更快成交可以撤单后改价，但要注意价格笼子。';
    }
    return { steps: steps.concat(['get_orders(' + o.no + ')', 'get_quote(' + SEC[o.code].sym + ')']), answer: ans, links: [['看这笔委托', () => go('orderDetail', { id: o.id })]] };
  }
  if (a.kind === 'cancel' && o) return { steps: steps.concat(['get_orders(' + o.no + ')']), answer: '你 ' + when + ' 撤掉了' + ordText(o) + '。\n\n' + (o.side === 'B' ? '这笔买单冻结的资金已经回到「可用」，现在可用 ' + money(S.cash - S.frozen) + ' 元。' : '这笔卖单冻结的股份已经回到「可卖」。') + (o.filled ? '\n撤单前已成交的 ' + intf(o.filled) + ' 不受影响，照常计费。' : '\n没有成交，所以不收费用。') + '\n撤单不收费。' };
  if (a.kind === 'transfer') { const ac = account(); return { steps: steps.concat(['get_positions()']), answer: '你 ' + when + ' ' + a.text + '。\n\n现在可用 ' + money(ac.available) + '，可取 ' + money(ac.withdrawable) + '。\n· 可用：能用来买入的钱，卖出后马上增加。\n· 可取：能转回银行的钱。今天卖出的钱要到下一交易日清算后才可取。\n· 入金是这个 App 里唯一「模拟」的部分。' }; }
  if (a.kind === 'learn' && a.ref && a.ref.lesson) {
    const l = LESSONS.find(x => x.id === a.ref.lesson), q = l.quiz[a.ref.qi];
    return { steps: steps.concat(['get_rule(' + l.title + ')']), answer: '「' + aiPlain(q.q) + '」\n正确答案是「' + aiPlain(q.o[q.a]) + '」。\n\n' + aiPlain(q.e), links: [['回到「' + l.title + '」', () => go('lesson', { id: l.id })]] };
  }
  if (a.kind === 'learn' && /校准/.test(a.text)) return { steps: steps.concat(['get_fee_profile()']), answer: a.text + '。\n\n现在的' + feeState() + '。\n佣金对不上时，交割单校准页可以按你的真实交割单反推佣金率并直接更新；印花税和过户费是法定的，对不上通常是抄错了数字，或者券商把规费单列了（打开「规费另收」）。', links: [['回到交割单校准', () => go('calibrate')]] };
  if (a.kind === 'system') return { steps, answer: '日终清算（15:30 后）做了这些事：\n· 撤销当日没成交的委托（当日有效）\n· 今天买入的股票明天可卖（T+1 解锁）\n· 今天卖出的钱变为可取\n· 记录当日净值，给账户分析用\n· 有分红的持仓卖出后，下一交易日补扣股息红利税' };
  return { steps, answer: '你最近的操作：\n' + c.acts.filter(x => x.kind !== 'view').slice(-6).map(x => '· ' + actLine(x)).join('\n') };
}

// ---------- 对话列表、记忆、上下文设置 ----------
SCREENS.aiThreads = {
  title: '对话与记忆', fab: false,
  render() {
    const ths = S.ai.threads.filter(t => t.msgs.length || t.summary || t.id === S.ai.cur);
    const n = t => t.compacted + t.msgs.filter(m => m.role === 'u' || m.role === 'a').length;
    return '<div style="padding:10px"><button class="btn ghost block" onclick="newThread()">＋ 新对话</button></div>' +
      '<div class="sec"><div class="row tap" onclick="go(\'aiMemory\')"><div class="grow">AI 记忆<div class="muted" style="font-size:12px">你告诉 AI 的背景、偏好、计划和约定，跨对话有效</div></div><span class="muted">' + S.ai.mem.length + ' 条</span><span class="chev"></span></div>' +
      '<div class="row tap" onclick="go(\'aiCtx\')"><div class="grow">上下文设置<div class="muted" style="font-size:12px">当前页面、最近操作、自动摘要，以及每次实际发送的内容</div></div><span class="chev"></span></div></div>' +
      '<div class="sec"><div class="sec-h">对话 <small>都保存在本机</small></div>' + ths.map(t => '<div class="row tap" onclick="openThread(' + t.id + ')"><div class="grow"><b style="font-weight:500">' + esc(t.title || '新对话') + '</b><div class="muted" style="font-size:12px">' + t.updated + ' · ' + n(t) + ' 条消息' + (t.summary ? ' · 有摘要' : '') + '</div></div>' + (t.id === S.ai.cur ? '<span class="ostat done">当前</span>' : '') + '<button class="btn sm ghost" onclick="event.stopPropagation();delThread(' + t.id + ')">删除</button></div>').join('') + '</div>' +
      '<div class="note" style="margin:0 10px 14px">每个对话单独保存。超过 ' + S.ai.cfg.compactAfter + ' 条消息时，较早的部分压缩成摘要，只把摘要和最近几轮原文发给模型。<br>别的对话不会整段带进来，需要时 AI 用 search_conversations 检索它们的摘要。长期有用的事存成「记忆」。</div>';
  }
};
const MEM_KINDS = [['背景', '你是谁、在学什么'], ['偏好', '风格和习惯'], ['计划', '打算做什么'], ['约定', '你让 AI 记住的事']];
let memDraft = '', memKind = '偏好';
SCREENS.aiMemory = {
  title: 'AI 记忆', fab: false,
  render() {
    const mode = S.ai.cfg.memory;
    let h = '<div class="sec"><div class="row"><span class="grow">记忆方式</span><div class="mseg">' + [['auto', '自动记住'], ['confirm', '先问我'], ['off', '关闭']].map(([k, l]) => '<button class="' + (mode === k ? 'on' : '') + '" onclick="S.ai.cfg.memory=\'' + k + '\';refresh()">' + l + '</button>').join('') + '</div></div></div>';
    for (const [k, d] of MEM_KINDS) {
      const ms = S.ai.mem.filter(m => m.kind === k); if (!ms.length) continue;
      h += '<div class="sec"><div class="sec-h">' + k + ' <small>' + d + '</small></div>' + ms.map(m => '<div class="row"><div class="grow">' + esc(m.text) + '<div class="muted" style="font-size:11px">' + m.date + ' · 来自' + esc(m.src) + '</div></div><button class="btn sm ghost" onclick="memEdit(' + m.id + ')">改</button><button class="btn sm ghost" onclick="memUndo(' + m.id + ')">删</button></div>').join('') + '</div>';
    }
    if (!S.ai.mem.length) h += '<div class="empty">还没有记忆。在对话里说「我打算……」「记住……」，AI 会记下来。</div>';
    return h + '<div style="padding:10px"><button class="btn ghost block" onclick="memAdd()">＋ 手动添加</button></div>' +
      '<div class="note" style="margin:0 10px 14px"><b>记什么：</b>你说过的背景、偏好、计划和约定，例如「不做短线」「五粮液是练习仓」。<br><b>不记什么：</b>持仓、成交、费率、行情。这些 App 里有最新值，AI 每次用工具现查，记下来反而会过时。<br><b>怎么用：</b>全部记忆（上限 50 条，约 1k tokens）每次都放在系统提示后面一起发送；超过上限时提示你合并。</div>';
  }
};
function memEdit(id) {
  const m = S.ai.mem.find(x => x.id === id); memDraft = m.text;
  modal({ title: '修改记忆', body: '<div class="fld" style="height:auto;padding:8px"><textarea oninput="memDraft=this.value" style="width:100%;min-height:72px;border:0;outline:0;font:inherit;resize:none">' + esc(m.text) + '</textarea></div>', ok: '保存', onOk: () => { if (memDraft.trim()) m.text = memDraft.trim(); refresh(); } });
}
function memAdd() {
  memDraft = '';
  modal({ title: '添加记忆', body: '<div class="fld" style="height:34px;margin-bottom:8px"><select onchange="memKind=this.value">' + MEM_KINDS.map(([k]) => '<option' + (k === memKind ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></div><div class="fld" style="height:auto;padding:8px"><textarea oninput="memDraft=this.value" placeholder="例如：只在周一集合竞价调仓" style="width:100%;min-height:72px;border:0;outline:0;font:inherit;resize:none"></textarea></div>', ok: '添加', onOk: () => { if (memDraft.trim()) { addMem(memDraft.trim(), memKind, null); refresh(); } } });
}
SCREENS.aiCtx = {
  title: '发给 AI 的上下文', fab: false,
  render() {
    const c = buildCtx(), x = ctxCost(c), cfg = S.ai.cfg;
    const seg = (vals, curV, js) => '<div class="mseg">' + vals.map(([v, l]) => '<button class="' + (curV === v ? 'on' : '') + '" onclick="' + js + '=' + JSON.stringify(v).replace(/"/g, '&quot;') + ';refresh()">' + l + '</button>').join('') + '</div>';
    const blk = (t, body, extra) => '<div class="sec"><div class="sec-h">' + t + (extra || '') + '</div><div class="cblk">' + body + '</div></div>';
    let h = '<div class="note lt" style="margin:10px">每次提问，App 会把下面这些内容和你的问题一起发给「' + esc(aiSvc().name) + '」。只发给你自己配置的服务，不经过别的服务器；所有内容都存在本机。</div>';
    h += '<div class="sec"><div class="row"><div class="grow">附带当前页面<div class="muted" style="font-size:11px">你在看哪个页面、页面上的关键数字和表单内容</div></div>' + seg([[true, '开'], [false, '关']], cfg.page, 'S.ai.cfg.page') + '</div>' +
      '<div class="row"><div class="grow">附带最近操作<div class="muted" style="font-size:11px">下单、撤单、成交、转账、浏览、学习</div></div>' + seg([[0, '关'], [5, '5'], [10, '10'], [20, '20']], cfg.acts, 'S.ai.cfg.acts') + '</div>' +
      '<div class="row tap" onclick="go(\'aiMemory\')"><div class="grow">长期记忆<div class="muted" style="font-size:11px">' + { auto: '自动记住', confirm: '先问我', off: '关闭' }[cfg.memory] + ' · ' + S.ai.mem.length + ' 条</div></div><span class="chev"></span></div>' +
      '<div class="row"><div class="grow">自动摘要<div class="muted" style="font-size:11px">对话超过这么多条消息，较早部分压缩成摘要</div></div>' + seg([[10, '10'], [20, '20'], [40, '40']], cfg.compactAfter, 'S.ai.cfg.compactAfter') + '</div></div>';
    const on = aiSvc().cache !== 'off', est = cacheEstimate(c, ''), U = c.th.usage;
    const rows = [['工具定义 + 固定系统提示', x.sys + x.tools, '随版本', on ? '断点 1' : ''], ['记忆快照 ' + c.mems.length + ' 条' + (c.th.summary ? ' + 对话摘要' : ''), x.mem + x.sum, '换对话 / 压缩时', on ? '断点 2' : ''], ['历史消息（含当时附带的页面和操作）', x.hist, '只追加', on ? '自动断点' : ''], ['当前页面', x.page, '每次', ''], ['最近 ' + c.acts.length + ' 条操作', x.acts, '每次', ''], ['你的问题', '—', '每次', '']];
    h += '<div class="sec"><div class="sec-h">一次请求的组成 <small>按发送顺序，约 ' + kfmt(x.total) + ' tokens</small></div><table class="t n"><tr><th>#</th><th style="text-align:left">内容</th><th>tokens</th><th>变化</th><th>缓存</th></tr>' + rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td style="text-align:left">' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('') + '</table><div class="muted" style="font-size:11px;padding:6px 14px 10px">不变的在前，每次都变的页面和操作放在最后一条用户消息里。这一条发出后原样留在历史里，下一轮就成了可缓存的前缀。</div></div>';
    h += '<div class="sec"><div class="sec-h">缓存 <small>' + esc(aiSvc().name) + ' · ' + (on ? '已开启' : '已关闭') + '</small></div><div class="cblk">' +
      (on ? '下一次提问预计：缓存读 ' + kfmt(est.read) + '，写入 ' + kfmt(est.write) + ' tokens' + (est.read ? '' : '（缓存是冷的：超过 5 分钟没提问、刚压缩过，或者第一次用这个服务）') : '这个服务关闭了缓存参数（有些中转服务不认识这些字段）。') + '\n' +
      (U ? '本对话累计 ' + U.n + ' 次请求：缓存读 ' + kfmt(U.read) + '，写 ' + kfmt(U.write) + '，命中率 ' + fx(U.read / Math.max(1, U.read + U.write + U.unc) * 100, 0) + '%' + (U.base ? '，费用 ' + usd(U.cost) + '，不用缓存要 ' + usd(U.base) + '，省 ' + fx((1 - U.cost / U.base) * 100, 0) + '%' : '') + '\n' : '') +
      (memPending(c.th) ? '<b>有记忆变动还没进入本对话的 system：</b>为了不打断缓存，从下一个对话或下一次压缩开始生效。本对话里 AI 已经通过 remember 的结果知道了。\n' : '') +
      '\n会让缓存失效的操作：切换 AI 服务或模型、改思考强度、压缩对话（每次压缩重建一次）、超过 5 分钟没提问。\n不会失效的：切换页面、开关页面上下文、调整最近操作条数、新增记忆（下个对话才生效）。</div></div>';
    h += blk('当前页面', c.page ? '<b>' + esc(c.page.name) + '</b>\n' + c.page.lines.map(l => '· ' + esc(l)).join('\n') : '（已关闭）');
    h += blk('最近操作', c.acts.length ? c.acts.slice().reverse().map(a => esc(actLine(a))).join('\n') : '（已关闭）', ' <button class="btn sm ghost" onclick="S.acts=[];showToast(\'已清空操作记录\');refresh()">清空</button>');
    h += blk('长期记忆', c.mems.length ? c.mems.map(m => '[' + m.kind + '] ' + esc(m.text)).join('\n') : '（无或已关闭）');
    h += blk('当前对话', (c.th.summary ? '<b>摘要</b>\n' + esc(c.th.summary) + '\n\n' : '') + '最近消息 ' + c.th.msgs.filter(m => m.role === 'u' || m.role === 'a').length + ' 条，原文发送');
    h += blk('系统提示', esc(SYS_PROMPT));
    h += blk('工具 <small>只读，没有下单工具</small>', AI_TOOLS.map(t => '<span class="mono">' + esc(t[0]) + '</span>  ' + esc(t[1])).join('\n'));
    h += blk('实际请求（' + protoName(aiSvc().protocol) + '，示意）', '<span class="mono" style="font-size:10.5px">' + esc(reqPreview(c)) + '</span>');
    return h;
  }
};
SCREENS.aiServices = {
  title: 'AI 服务',
  render() {
    return '<div class="sec">' + S.ai.services.map(s => '<div class="row tap" onclick="S.ai.active=' + s.id + ';refresh()"><div class="grow"><b style="font-weight:500">' + s.name + '</b><div class="muted" style="font-size:12px">' + protoName(s.protocol) + ' · ' + s.model + '</div><div class="muted mono" style="font-size:11px">' + s.base + ' · ' + s.key + '</div></div>' + (S.ai.active === s.id ? '<span class="ostat done">使用中</span>' : '') + '<button class="btn sm ghost" onclick="event.stopPropagation();go(\'aiEdit\',{id:' + s.id + '})">编辑</button></div>').join('') + '</div>' +
      '<div style="padding:10px"><button class="btn ghost block" onclick="go(\'aiEdit\',{id:0})">＋ 添加服务</button></div>' +
      '<div class="sec"><div class="row tap" onclick="go(\'aiCtx\')"><span class="grow">上下文设置</span><span class="muted" style="font-size:12px">页面 · 最近操作 · 摘要</span><span class="chev"></span></div><div class="row tap" onclick="go(\'aiMemory\')"><span class="grow">AI 记忆</span><span class="muted" style="font-size:12px">' + S.ai.mem.length + ' 条</span><span class="chev"></span></div></div>' +
      '<div class="note" style="margin:0 10px">只支持两种协议：OpenAI Responses API 和 Anthropic Messages API。兼容这两种协议的服务（例如各类中转或国产模型的兼容接口）填对 Base URL 就能用。API Key 存在 Android Keystore / iOS Keychain，只保存在本机。</div>';
  }
};
SCREENS.aiEdit = {
  title: p => p.id ? '编辑服务' : '添加服务', fab: false,
  render(p) {
    const s = S.ai.services.find(x => x.id === p.id) || { name: '', protocol: 'responses', base: 'https://', model: '', key: '', cache: 'auto', price: null };
    const f = (k, l, ph) => '<div class="row"><span style="width:80px" class="ink2">' + l + '</span><div class="fld grow" style="height:34px;padding:0 8px"><input id="ae_' + k + '" value="' + esc(s[k]) + '" placeholder="' + ph + '" style="text-align:left;font-size:13px;font-family:var(--zh)"></div></div>';
    const sg = (id, cur, opts) => '<div class="mseg" id="' + id + '" data-v="' + cur + '">' + opts.map(([k, l]) => '<button class="' + (cur === k ? 'on' : '') + '" onclick="this.parentNode.querySelectorAll(\'button\').forEach(b=>b.classList.remove(\'on\'));this.classList.add(\'on\');this.parentNode.dataset.v=\'' + k + '\'">' + l + '</button>').join('') + '</div>';
    const pr = s.price || {}, pf = (k, l) => '<div style="flex:1"><div class="muted" style="font-size:11px;margin-bottom:2px">' + l + '</div><div class="fld" style="height:32px;padding:0 6px"><input id="ae_p_' + k + '" inputmode="decimal" value="' + (pr[k] != null ? pr[k] : '') + '" placeholder="—" style="font-size:13px"></div></div>';
    return '<div class="sec">' + f('name', '名称', '例如 Claude') + '<div class="row"><span style="width:80px" class="ink2">协议</span>' + sg('ae_proto', s.protocol, [['responses', 'OpenAI Responses'], ['messages', 'Anthropic Messages']]) + '</div>' + f('base', 'Base URL', 'https://api.example.com') + f('model', '模型', 'model id') + f('key', 'API Key', 'sk-...') + '</div>' +
      '<div class="sec"><div class="row"><div class="grow">缓存参数<div class="muted" style="font-size:11px">自动：按协议发送 cache_control / prompt_cache_key。中转服务报「未知字段」时选关闭</div></div>' + sg('ae_cache', s.cache || 'auto', [['auto', '自动'], ['off', '关闭']]) + '</div>' +
      '<div style="padding:8px 14px 12px"><div class="ink2" style="font-size:13px;margin-bottom:6px">价格（美元 / 百万 tokens，选填，用来估算费用）</div><div style="display:flex;gap:6px">' + pf('in', '输入') + pf('out', '输出') + pf('cr', '缓存读') + pf('cw', '缓存写') + '</div></div></div>' +
      '<div style="padding:10px;display:flex;gap:8px"><button class="btn ghost" style="flex:1" onclick="showToast(\'原型不联网：真实 App 会发一条 1 token 的请求测试连接，并检查缓存参数是否被接受\')">测试连接</button><button class="btn buy" style="flex:1" onclick="saveAI(' + (p.id || 0) + ')">保存</button></div>' +
      '<div class="note" style="margin:0 10px">Responses：POST {Base URL}/v1/responses，工具用 function 定义，缓存由服务端自动做，App 只发 prompt_cache_key。<br>Messages：POST {Base URL}/v1/messages，需 anthropic-version 头，工具用 tool_use / tool_result，缓存要显式打 cache_control 断点。<br>测试连接时如果服务拒绝缓存字段，App 会自动把「缓存参数」改成关闭。</div>';
  }
};
function saveAI(id) {
  const g = k => $('#ae_' + k).value, old = S.ai.services.find(x => x.id === id) || {};
  const num = k => { const v = parseFloat($('#ae_p_' + k).value); return isNaN(v) ? null : v; };
  const price = { in: num('in'), out: num('out'), cr: num('cr'), cw: num('cw') };
  const s = { id: id || Date.now(), name: g('name') || '未命名', protocol: $('#ae_proto').dataset.v, base: g('base'), model: g('model'), key: g('key').replace(/^(.{5}).*(.{4})$/, '$1•••• $2'), cache: $('#ae_cache').dataset.v, price: Object.values(price).every(v => v != null) ? price : null };
  const i = S.ai.services.findIndex(x => x.id === id); if (i >= 0) S.ai.services[i] = s; else S.ai.services.push(s);
  if (old.model && old.model !== s.model) showToast('换了模型：缓存按模型隔离，下一次请求会重新写缓存');
  back(); showToast('已保存');
}

// ---------- 示例数据：一段 10/23 的旧对话和几条记忆 ----------
function seedAI() {
  const th = { id: ++seq, title: '白酒行业和五粮液', created: '2026-10-23', updated: '2026-10-23', compacted: 12, lastPage: '个股 · 五粮液', msgs: [],
    summary: '10/23 你问了白酒行业现在的估值、五粮液和贵州茅台的区别、五粮液的分红。结论：白酒估值比前两年低，但行业增速放缓；两家的差别主要在产品价格带和渠道；你决定先用小仓位买五粮液练手。' };
  const mk = (kind, text, date, src) => { const m = { id: ++seq, kind, text, date, src: src || '对话「' + th.title + '」', th: src ? null : th.id }; S.ai.mem.push(m); return m.id; };
  mk('背景', 'Java / Go 后端工程师，正在学 Python，目标是打好个人量化基础', '2026-10-20', '手动添加');
  const m2 = mk('计划', '每月约 5000 元定投；先把规则学明白，不做短线', '2026-10-23');
  const m3 = mk('偏好', '宽基 ETF 做底仓，个股只用小仓位练习', '2026-10-23');
  const m4 = mk('约定', '五粮液那笔是练习仓，止损规则还没定', '2026-10-23');
  const cx = '个股 · 五粮液 · 最近 10 条操作 · 1 条记忆 · 对话摘要';
  th.msgs = [
    { role: 'u', text: '我每个月大概能拿出 5000 块定投，主要是想先把规则学明白，不做短线。', ctx: cx },
    { role: 'a', done: true, text: '明白。按这个节奏，建议先拿宽基 ETF（比如沪深 300 ETF）做底仓，个股只用小仓位练习下单和看交割单。这样即使个股看错，学费也有限。', memIds: [m2, m3] },
    { role: 'u', text: '那五粮液这笔就当练习仓吧，止损我还没想好。', ctx: cx },
    { role: 'a', done: true, text: '好。止损规则最好在买入前写下来，而且要写得能执行，比如「收盘价跌破成本 8% 就卖」或者「季报营收同比转负就卖」。想好了告诉我，或者直接写进「学习 → 模拟执行 → 交易纪律」。', memIds: [m4] }
  ];
  const now = newThreadObj();
  S.ai.threads = [now, th]; S.ai.cur = now.id;
}
