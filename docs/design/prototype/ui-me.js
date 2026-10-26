/* AShareSim 原型 · 我的 / AI / 设置 / 控制台 / 启动 */
'use strict';
SCREENS.me = {
  title: '我的', root: true,
  render() {
    const a = account();
    const it = (l, d, f) => '<div class="row tap" onclick="' + f + '"><span class="grow">' + l + '</span><span class="muted" style="font-size:12px">' + d + '</span><span class="chev"></span></div>';
    return '<div class="sec" style="padding:16px 14px;display:flex;gap:12px;align-items:center"><div style="width:48px;height:48px;border-radius:24px;background:#1F2329;color:#fff;display:grid;place-items:center;font-weight:700">BF</div><div class="grow"><div style="font-weight:600;font-size:16px">模拟账户 · 仅本机</div><div class="muted" style="font-size:12px">总资产 <span class="n">' + money(a.total) + '</span> · 净入金 <span class="n">' + money(S.depositTotal) + '</span> / ' + money(S.depositCap) + '</div></div></div>' +
      '<div class="sec">' + it('银证转账（模拟入金）', '上限 ' + (S.depositCap / 1e4) + ' 万', "go('transfer')") + it('资金流水', S.flows.length + ' 条', "go('flows')") + it('交割单', '可导出 CSV', "go('orders',{tab:'ledger'})") + '</div>' +
      '<div class="sec">' + it('费率与账户', '万' + (S.fee.rate * 1e4).toFixed(2) + (S.fee.mian5 ? ' 免五' : ' 最低5元'), "go('fees')") + it('交割单校准', S.checks['s0-e0'] ? '已校准' : '未校准', "go('calibrate')") + '</div>' +
      '<div class="sec">' + it('AI 服务', S.ai.services.find(s => s.id === S.ai.active).name + ' · ' + protoName(S.ai.services.find(s => s.id === S.ai.active).protocol), "go('aiServices')") + it('行情数据源', '腾讯 · 3 秒', "go('dataSource')") + it('外观', '浅色 · 红涨绿跌', "showToast('设置里可切换深色和「绿涨红跌」')") + '</div>' +
      '<div class="sec">' + it('重置模拟账户', '旧账户归档', "resetAcct()") + it('关于与免责声明', 'v0.1 原型', "go('about')") + '</div>';
  }
};
function resetAcct() { modal({ title: '重置模拟账户', body: '<div class="ink2" style="font-size:13px">当前账户的持仓、委托、交割单会归档（可以在「历史账户」里查看和导出），然后从 0 元开始，你需要重新模拟入金。原型里会恢复成示例账户。</div>', ok: '重置', onOk: () => { seed(); tab('trade'); showToast('已重置'); } }); }
SCREENS.fees = {
  title: '费率与账户',
  render() {
    const F = S.fee;
    const num = (k, l, mul, unit) => '<div class="row"><span class="grow">' + l + '</span><div class="fld" style="width:110px;height:32px"><input value="' + +(F[k] * mul).toFixed(4) + '" onchange="S.fee.' + k + '=parseFloat(this.value)/' + mul + ';refresh()"></div><span class="muted" style="width:28px;font-size:12px">' + unit + '</span></div>';
    const sw = (k, l, d) => '<div class="row tap" onclick="S.fee.' + k + '=!S.fee.' + k + ';refresh()"><div class="grow">' + l + '<div class="muted" style="font-size:11px">' + d + '</div></div><span class="ostat ' + (F[k] ? 'done' : '') + '">' + (F[k] ? '开' : '关') + '</span></div>';
    return '<div class="sec"><div class="sec-h">佣金 <small>以你开户券商的为准</small></div>' + num('rate', '股票佣金率', 1e4, '‱') + num('min', '股票最低佣金', 1, '元') + num('etfRate', 'ETF 佣金率', 1e4, '‱') + num('etfMin', 'ETF 最低佣金', 1, '元') + sw('mian5', '免五', '不设 5 元最低佣金（按 0.1 元起收）') + sw('regsSeparate', '规费另收', '默认经手费、证管费含在佣金里；有些券商单列') + sw('mergeOrder', '同一委托多笔成交合并计佣', '大多数券商按委托合并计算最低 5 元') + '</div>' +
      '<div class="sec"><div class="sec-h">法定费用 <small>不可改，规则更新时随版本发布</small></div><table class="t"><tr><td>印花税</td><td>卖出 0.05%（ETF 免）</td></tr><tr><td>过户费</td><td>双向 0.001%（ETF 免）</td></tr><tr><td>经手费</td><td>双向 0.00341%</td></tr><tr><td>证管费</td><td>双向 0.002%</td></tr><tr><td>红利税</td><td>≤1 月 20%，1 月–1 年 10%，＞1 年免</td></tr></table></div>' +
      '<div class="sec"><div class="sec-h">账户</div>' + num('__cap', '模拟入金上限', 1, '元').replace("S.fee.__cap=parseFloat(this.value)/1", "S.depositCap=parseFloat(this.value)").replace('value="NaN"', 'value="' + S.depositCap + '"') + '</div>' +
      '<div style="padding:10px"><button class="btn lt block" onclick="go(\'calibrate\')">用真实交割单校准</button></div>';
  }
};
const CAL_IN = { code: 'sh600036', side: 'S', price: '', qty: '', commission: '', stamp: '', transfer: '' };
const CAL_PH = { price: '例 41.80', qty: '例 1000', commission: '例 10.45', stamp: '例 20.90', transfer: '例 0.42' };
SCREENS.calibrate = {
  title: '交割单校准',
  render() {
    const f = (k, l) => '<div class="row"><span class="grow">' + l + '</span><div class="fld" style="width:140px;height:32px"><input value="' + CAL_IN[k] + '" placeholder="' + CAL_PH[k] + '" oninput="CAL_IN.' + k + '=this.value"></div></div>';
    return '<div class="note lt" style="margin:10px">从你真实券商 App 的交割单里抄一条成交，App 用当前费率重算并逐项比对。不一致时告诉你该改哪一项设置。这是「费用和真实一致」的验收方法。</div>' +
      '<div class="sec"><div class="row"><span class="grow">证券</span><div class="fld" style="width:140px;height:32px"><select onchange="CAL_IN.code=this.value">' + STOCKS.map(c => '<option value="' + c + '"' + (c === CAL_IN.code ? ' selected' : '') + '>' + SEC[c].name + '</option>').join('') + '</select></div></div>' +
      '<div class="row"><span class="grow">方向</span><div class="fld" style="width:140px;height:32px"><select onchange="CAL_IN.side=this.value"><option value="B"' + (CAL_IN.side === 'B' ? ' selected' : '') + '>买入</option><option value="S"' + (CAL_IN.side === 'S' ? ' selected' : '') + '>卖出</option></select></div></div>' +
      f('price', '成交价') + f('qty', '数量') + f('commission', '佣金') + f('stamp', '印花税') + f('transfer', '过户费') + '</div><div style="padding:10px"><button class="btn lt block" onclick="doCalibrate()">比对</button></div><div id="calout"></div>';
  }
};
function doCalibrate() {
  if (!(parseFloat(CAL_IN.price) > 0 && parseInt(CAL_IN.qty) > 0)) return ruleError({ rule: '请填写', msg: '从真实交割单抄写成交价、数量和各项费用。' });
  const amt = r2(parseFloat(CAL_IN.price) * parseInt(CAL_IN.qty)), f = calcFee(CAL_IN.code, CAL_IN.side, amt);
  const items = [['佣金', f.commission, parseFloat(CAL_IN.commission)], ['印花税', f.stamp, parseFloat(CAL_IN.stamp)], ['过户费', f.transfer, parseFloat(CAL_IN.transfer)]];
  const allOk = items.every(i => Math.abs(i[1] - i[2]) < 0.005);
  let tip = '';
  const dc = items[0][2] - items[0][1];
  if (Math.abs(dc) >= 0.005) { const impl = items[0][2] / amt * 1e4; tip = '你的交割单佣金相当于万 ' + fx(impl, 3) + '。' + (items[0][2] <= 5.0001 && items[0][2] >= 4.995 ? '看起来触发了最低 5 元。' : '把「股票佣金率」改成 ' + fx(impl, 2) + '‱ 试试' + (impl * 1e-4 * amt < 5 ? '，并打开「免五」' : '') + '。'); }
  $('#calout').innerHTML = '<div class="sec"><table class="t n"><tr><th>项目</th><th>App 计算</th><th>交割单</th><th></th></tr>' + items.map(i => '<tr><td>' + i[0] + '</td><td>' + money(i[1]) + '</td><td>' + money(i[2]) + '</td><td class="' + (Math.abs(i[1] - i[2]) < 0.005 ? 'ok' : 'no') + '">' + (Math.abs(i[1] - i[2]) < 0.005 ? '一致' : '差 ' + fx(i[2] - i[1], 2)) + '</td></tr>').join('') + '</table><div style="padding:10px 14px" class="' + (allOk ? 'ok' : 'ink2') + '">' + (allOk ? '全部一致。费率设置和你的券商对上了。' : tip) + '</div></div>';
  if (allOk) autoCheck('s0-e0', '费率已用真实交割单校准');
}
SCREENS.dataSource = {
  title: '行情数据源',
  render() {
    return '<div class="sec"><div class="row"><div class="grow">腾讯行情（主）<div class="muted mono" style="font-size:11px">qt.gtimg.cn · web.ifzq.gtimg.cn</div></div><span class="ostat done">使用中</span></div><div class="row"><div class="grow">新浪行情（交叉核对）<div class="muted mono" style="font-size:11px">hq.sinajs.cn</div></div><span class="ostat">每日收盘后</span></div><div class="row"><div class="grow">东方财富（分红送配、F10）<div class="muted mono" style="font-size:11px">datacenter / emweb</div></div><span class="ostat">待确认</span></div></div>' +
      '<div class="sec"><div class="row"><span class="grow">前台刷新频率</span><span class="n">3 秒</span></div><div class="row"><span class="grow">后台</span><span>停止刷新，回到前台补数据</span></div><div class="row"><span class="grow">K 线复权</span><span>前复权（看图）/ 不复权（撮合）</span></div></div>' +
      '<div class="note" style="margin:10px">腾讯免费接口只有约 3 秒一次的快照和五档，没有逐笔成交，所以排队位置是估计的，见规则规格 §6.5。</div>';
  }
};
SCREENS.about = {
  title: '关于与免责声明',
  render() {
    return '<div class="lesson"><p><b>AShareSim</b> v0.1 原型 · GPL-3.0</p><p>本 App 只用于学习和模拟，不构成投资建议，不连接任何真实券商，不能下真实订单。</p><p>规则和费率依据：上交所、深交所交易规则（2026-07-06 施行版），财税〔2015〕101 号，中国结算收费标准。规则变化以交易所、中国结算和你的券商最新公告为准。</p><p>模拟成交和真实成交仍然有差别：排队位置是估计的；行情是 3 秒快照；你的单子不会真的影响市场；模拟的钱亏了不疼。</p><p>AI 回答仅供学习，可能出错，涉及的数字请以行情和公告原文为准。</p></div>';
  }
};

// ---------- AI ----------
const protoName = p => p === 'messages' ? 'Anthropic Messages' : 'OpenAI Responses';
let aiCtx = null;
function openAI(intent, code) {
  const c = cur();
  const ctxCode = code || (c.p && c.p.code) || null;
  aiCtx = { code: ctxCode && SEC[ctxCode] && SEC[ctxCode].board !== 'index' ? ctxCode : null, from: c.name };
  go('ai', { intent });
}
SCREENS.ai = {
  title: () => 'AI 助手<span class="sub">' + (s => s.name + ' · ' + protoName(s.protocol) + ' · ' + s.model)(S.ai.services.find(s => s.id === S.ai.active)) + '</span>',
  fab: false,
  navRight: () => '<button class="ib" onclick="go(\'aiServices\')" aria-label="AI 设置">⚙</button>',
  render(p) {
    const ctx = aiCtx || {};
    let h = '<div class="ctx">上下文：' + (ctx.code ? '<span class="c">' + SEC[ctx.code].name + '</span>' : '') + '<span class="c">我的持仓</span><span class="c">交易规则</span><span style="flex:1"></span><span class="muted">只读，不能下单</span></div>';
    h += '<div class="chat" id="chat">' + (S.ai.chat.length ? S.ai.chat.map(m => m.role === 'steps' ? '<div class="steps">' + m.items.map(x => '<span>' + esc(x) + '</span>').join('') + '</div>' : '<div class="msg ' + m.role + '"><span class="tx">' + esc(m.text) + '</span>' + (m.role === 'a' ? '<span class="disc">仅供学习，不构成投资建议</span>' : '') + '</div>').join('') : '<div class="empty">问我关于股票、公司、交易规则和你的账户的问题。<br>我会先读取数据再回答，读了什么会显示出来。</div>') + '</div>';
    return h;
  },
  after(p) {
    const old = $('#aicomp'); if (old) old.remove();
    const code = (aiCtx || {}).code;
    const chips = (code ? [['company', '介绍这家公司'], ['trend', '近 3 个月走势怎么看'], ['rule', '这只股票的交易规则']] : []).concat([['fee', '解释最近一笔交割单的费用'], ['review', '复盘我今天的交易'], ['analysis', '解释我的账户分析']]);
    $('#tabbar').insertAdjacentHTML('beforebegin', '<div id="aicomp"><div class="chips">' + chips.map(([k, l]) => '<button onclick="aiAsk(\'' + k + '\',\'' + l + '\')">' + l + '</button>').join('') + '</div><div class="composer"><input id="aiin" placeholder="输入问题，例如：什么是市盈率？" onkeydown="if(event.key===\'Enter\')aiFree()"><button class="btn buy sm" onclick="aiFree()">发送</button></div><div class="muted" style="font-size:10px;padding:0 12px 6px;background:#fff">预计约 1.5k tokens / 次 · 原型为本地示例回复，不联网</div></div>');
    const v = $('#view'); v.scrollTop = v.scrollHeight;
    if (p.intent && !p.asked) { p.asked = true; const c = chips.find(x => x[0] === p.intent); if (c) aiAsk(c[0], c[1]); }
  }
};
const _aiRender = render;
render = function (reset) { const a = $('#aicomp'); if (a) a.remove(); return _aiRender(reset); };
function aiFree() { const v = $('#aiin').value.trim(); if (!v) return; const k = /费|佣金|印花/.test(v) ? 'fee' : /规则|涨停|T\+1|笼子/.test(v) ? 'rule' : /公司|介绍|主营/.test(v) ? 'company' : /走势|技术|均线/.test(v) ? 'trend' : /市盈率|PE/.test(v) ? 'pe' : 'general'; aiAsk(k, v); }
let aiBusy = false;
function aiAsk(kind, text) {
  if (aiBusy) return showToast('上一个问题还在回答');
  aiBusy = true;
  S.ai.chat.push({ role: 'u', text });
  const { steps, answer } = aiAnswer(kind, (aiCtx || {}).code);
  const st = { role: 'steps', items: [] }; S.ai.chat.push(st);
  refresh();
  let i = 0;
  const next = () => {
    if (cur().name !== 'ai') { aiBusy = false; return; }
    if (i < steps.length) { st.items.push(steps[i++]); refresh(); setTimeout(next, 380); return; }
    const m = { role: 'a', text: '' }; S.ai.chat.push(m); let j = 0;
    const type = () => { if (cur().name !== 'ai' || j >= answer.length) { m.text = answer; aiBusy = false; return; } j = Math.min(answer.length, j + 6); m.text = answer.slice(0, j); const el = $('#chat'); if (el) { el.lastElementChild.querySelector('.tx').textContent = m.text; $('#view').scrollTop = 1e6; } else refresh(); setTimeout(type, 16); };
    refresh(); type();
  };
  setTimeout(next, 300);
}
function aiAnswer(kind, code) {
  const s = code ? SEC[code] : null;
  if (kind === 'company' && s) {
    const q = DATA.quotes[code], sn = snap(code, S.t);
    return { steps: ['get_company_profile(' + s.sym + ')', 'get_quote(' + s.sym + ')', 'get_financials(' + s.sym + ', 最近 4 期)'],
      answer: (PROFILE[code] || s.fullName + '：原型没有内置这家公司的资料，真实 App 会读取 F10。') + '\n\n几个关键数字（' + hms(S.t) + '）：\n· 现价 ' + px(code, sn.price) + '，' + pctS(sn.pct) + '\n' + (s.board === 'etf' ? '· 这是基金，没有市盈率；关注跟踪误差、规模和管理费。\n' : '· 市盈率（动）约 ' + fx(q.pe, 1) + '，市净率 ' + fx(q.pb, 2) + '\n· 总市值约 ' + fx(q.totalCap, 0) + ' 亿元\n') + '· 52 周区间 ' + px(code, q.w52l) + ' – ' + px(code, q.w52h) + '\n\n要深入了解，建议按这个顺序看：主营构成（钱从哪来）→ 近 3 年营收和净利润增速 → 毛利率和现金流 → 估值和同行对比。需要的话我可以逐项展开。' };
  }
  if (kind === 'trend' && s) {
    const k = liveBars(code), n = k.length, c = k[n - 1][2];
    const ch = d => (c / k[n - 1 - d][2] - 1) * 100;
    const ma = d => k.slice(n - d).reduce((a, r) => a + r[2], 0) / d;
    const hi = Math.max(...k.slice(n - 60).map(r => r[3])), lo = Math.min(...k.slice(n - 60).map(r => r[4]));
    const v5 = k.slice(n - 5).reduce((a, r) => a + r[5], 0) / 5, v20 = k.slice(n - 20).reduce((a, r) => a + r[5], 0) / 20;
    return { steps: ['get_kline(' + s.sym + ', 日线, 前复权, 120 根)', '计算 MA20 / MA60、区间涨跌、量能'],
      answer: s.name + ' 近期表现（前复权）：\n· 近 20 日 ' + pctS(ch(20)) + '，近 60 日 ' + pctS(ch(60)) + '\n· 现价 ' + px(code, c) + '，MA20 ' + px(code, ma(20)) + '，MA60 ' + px(code, ma(60)) + '，价格在 MA20 ' + (c > ma(20) ? '上方' : '下方') + '、MA60 ' + (c > ma(60) ? '上方' : '下方') + '\n· 近 60 日区间 ' + px(code, lo) + ' – ' + px(code, hi) + '，现价处在区间 ' + fx((c - lo) / (hi - lo) * 100, 0) + '% 的位置\n· 近 5 日平均成交量是近 20 日的 ' + fx(v5 / v20, 2) + ' 倍\n\n怎么理解：均线和区间位置只描述「过去发生了什么」，不能预测未来。路线图阶段 4 会教你用 IC 检验这类信号到底有没有预测力——在那之前，别把它当买卖依据。' };
  }
  if (kind === 'rule' && s) {
    const m = MK[code], a = availableQty(code);
    return { steps: ['get_rule(' + s.sym + ')', 'get_positions(' + s.sym + ')'],
      answer: s.name + ' 属于' + BOARD_NAME[s.board] + (s.st ? '（风险警示）' : '') + '：\n· 涨跌幅 ±' + s.limitPct * 100 + '%，今天 ' + px(code, m.down) + ' – ' + px(code, m.up) + '\n· ' + (s.board === 'kcb' ? '一次至少买 200 股，之后可以 1 股递增' : '买入以 100 ' + unitName(code) + '为单位') + '\n· 连续竞价时有价格笼子' + (s.board === 'kcb' ? '（只有 2%）' : '（2% 或 0.1 元取较宽者）') + '\n· T+1：今天买的明天才能卖' + (a.held ? '。你持有 ' + intf(a.held) + '，现在可卖 ' + intf(a.sellable) : '') + '\n· 费用：' + (s.board === 'etf' ? '只有佣金' : '佣金 + 过户费，卖出另收 0.05% 印花税') };
  }
  if (kind === 'fee') {
    const l = S.ledger.find(x => x.biz === '证券买入' || x.biz === '证券卖出');
    if (!l) return { steps: ['get_trades(最近 1 笔)'], answer: '还没有成交记录。' };
    const ss = SEC[l.code];
    return { steps: ['get_trades(最近 1 笔)', 'get_fee_profile()'],
      answer: l.date + ' ' + l.biz + ' ' + l.name + ' ' + intf(l.qty) + ' @ ' + px(l.code, l.price) + '，成交金额 ' + money(l.amount) + '：\n· 佣金 ' + money(l.commission) + '：金额 × 万' + ((ss.board === 'etf' ? S.fee.etfRate : S.fee.rate) * 1e4).toFixed(2) + ' = ' + money(l.amount * (ss.board === 'etf' ? S.fee.etfRate : S.fee.rate)) + (l.commission > l.amount * (ss.board === 'etf' ? S.fee.etfRate : S.fee.rate) + 0.01 ? '，不足 5 元按 5 元收' : '') + '\n· 印花税 ' + money(l.stamp) + (l.biz === '证券买入' ? '：买入不收' : '：卖出收 0.05%') + '\n· 过户费 ' + money(l.transfer) + (ss.board === 'etf' ? '：ETF 免收' : '：0.001%，买卖都收') + '\n· 经手费和证管费含在佣金里\n合计 ' + money(l.total) + ' 元，占成交额 ' + fx(l.total / l.amount * 100, 3) + '%。' };
  }
  if (kind === 'review') {
    const os = S.orders.filter(o => o.di === S.di);
    return { steps: ['get_orders(今天)', 'get_trades(今天)'],
      answer: '今天共 ' + os.length + ' 笔委托：\n' + os.map(o => '· ' + hms(o.t).slice(0, 5) + ' ' + (o.side === 'B' ? '买' : '卖') + ' ' + SEC[o.code].name + ' ' + intf(o.qty) + ' → ' + o.status + (o.reason ? '（' + o.reason + '）' : '')).join('\n') + '\n\n值得注意：' + (os.some(o => o.status === '废单') ? '有废单，原因是价格超出了价格笼子。卖出时挂得比买一低 2% 以上就会被拒，想快速卖出可以直接挂买一价。' : '没有废单。') + (os.some(o => o.status === '已报' || o.status === '部成') ? '\n还有未成交的挂单，收盘后会被系统撤销。' : '') };
  }
  if (kind === 'analysis') {
    const d = analysisData();
    return { steps: ['get_equity_history()', 'get_kline(沪深300)', '计算 beta / alpha / 跟踪误差'],
      answer: '从 ' + d.from + ' 到今天（' + d.n + ' 个交易日）：\n· 你的账户 ' + fx(d.totR * 100, 2) + '%，沪深300 ' + fx(d.bTot * 100, 2) + '%\n· Beta ' + fx(d.beta, 2) + '：大盘涨 1%，你的账户平均跟着动 ' + fx(d.beta, 2) + '%\n· 年化 Alpha ' + fx(d.alpha * 100, 2) + '%，跟踪误差 ' + fx(d.te * 100, 2) + '%，信息比率 ' + fx(d.ir, 2) + '\n· 超额的 t 值 ' + fx(d.tstat, 2) + (Math.abs(d.tstat) < 2 ? '，小于 2，统计上不能说明你跑赢或跑输是能力而不是运气。' : '，但样本太短，仍然不足以下结论。') + '\n\n也就是说，你的收益可以拆成「Beta × 基准收益」加「Alpha」，阶段 2 的通关标准就是能自己算出这几个数。' };
  }
  if (kind === 'pe') return { steps: ['get_rule(估值指标)'], answer: '市盈率（PE）= 股价 ÷ 每股收益，表示按现在的利润，多少年能「赚回」市值。\n· 静态 PE 用上一年年报利润，动态 PE 用最新季报年化，TTM 用最近四个季度。\n· 银行股 PE 常在 5 倍左右，消费、科技股常在 20–50 倍，不同行业不能直接比。\n· 亏损公司 PE 为负，没有意义，改看市销率或市净率。' };
  return { steps: ['search_knowledge()'], answer: '原型只内置了几个示例问题。真实 App 会把你的问题和上下文（当前股票、持仓、规则）发给你配置的模型，模型通过只读工具读取行情和账户数据后回答。' };
}
SCREENS.aiServices = {
  title: 'AI 服务',
  render() {
    return '<div class="sec">' + S.ai.services.map(s => '<div class="row tap" onclick="S.ai.active=' + s.id + ';refresh()"><div class="grow"><b style="font-weight:500">' + s.name + '</b><div class="muted" style="font-size:12px">' + protoName(s.protocol) + ' · ' + s.model + '</div><div class="muted mono" style="font-size:11px">' + s.base + ' · ' + s.key + '</div></div>' + (S.ai.active === s.id ? '<span class="ostat done">使用中</span>' : '') + '<button class="btn sm ghost" onclick="event.stopPropagation();go(\'aiEdit\',{id:' + s.id + '})">编辑</button></div>').join('') + '</div>' +
      '<div style="padding:10px"><button class="btn ghost block" onclick="go(\'aiEdit\',{id:0})">＋ 添加服务</button></div><div class="note" style="margin:0 10px">只支持两种协议：OpenAI Responses API 和 Anthropic Messages API。兼容这两种协议的服务（例如各类中转或国产模型的兼容接口）填对 Base URL 就能用。API Key 存在 Android Keystore / iOS Keychain，只保存在本机。</div>';
  }
};
SCREENS.aiEdit = {
  title: p => p.id ? '编辑服务' : '添加服务', fab: false,
  render(p) {
    const s = S.ai.services.find(x => x.id === p.id) || { name: '', protocol: 'responses', base: 'https://', model: '', key: '' };
    const f = (k, l, ph) => '<div class="row"><span style="width:80px" class="ink2">' + l + '</span><div class="fld grow" style="height:34px;padding:0 8px"><input id="ae_' + k + '" value="' + esc(s[k]) + '" placeholder="' + ph + '" style="text-align:left;font-size:13px;font-family:var(--zh)"></div></div>';
    return '<div class="sec">' + f('name', '名称', '例如 Claude') + '<div class="row"><span style="width:80px" class="ink2">协议</span><div class="seg" style="border:0;padding:0">' + [['responses', 'OpenAI Responses'], ['messages', 'Anthropic Messages']].map(([k, l]) => '<button class="' + (s.protocol === k ? 'on' : '') + '" onclick="this.parentNode.querySelectorAll(\'button\').forEach(b=>b.classList.remove(\'on\'));this.classList.add(\'on\');this.parentNode.dataset.v=\'' + k + '\'">' + l + '</button>').join('') + '</div></div>' + f('base', 'Base URL', 'https://api.example.com') + f('model', '模型', 'model id') + f('key', 'API Key', 'sk-...') + '</div>' +
      '<div style="padding:10px;display:flex;gap:8px"><button class="btn ghost" style="flex:1" onclick="showToast(\'原型不联网：真实 App 会发一条 1 token 的请求测试连接\')">测试连接</button><button class="btn buy" style="flex:1" onclick="saveAI(' + (p.id || 0) + ')">保存</button></div>' +
      '<div class="note" style="margin:0 10px">Responses：POST {Base URL}/v1/responses，工具用 function 定义。<br>Messages：POST {Base URL}/v1/messages，需 anthropic-version 头，工具用 tool_use / tool_result。</div>';
  }
};
function saveAI(id) {
  const g = k => $('#ae_' + k).value; const seg = $('.seg[data-v]');
  const proto = seg ? seg.dataset.v : (S.ai.services.find(x => x.id === id) || { protocol: 'responses' }).protocol;
  const s = { id: id || Date.now(), name: g('name') || '未命名', protocol: proto, base: g('base'), model: g('model'), key: g('key').replace(/^(.{5}).*(.{4})$/, '$1•••• $2') };
  const i = S.ai.services.findIndex(x => x.id === id); if (i >= 0) S.ai.services[i] = s; else S.ai.services.push(s);
  back(); showToast('已保存');
}

// ---------- 控制台 ----------
function renderClock() {
  const el = $('#cclock'); if (!el) return;
  const ph = phaseLabel();
  el.innerHTML = '<div class="d">' + today() + ' 周' + WD[new Date(today() + 'T00:00:00').getDay()] + ' · 第 ' + (S.di - dayIdx(TODAY_REAL) + 1) + ' 个模拟交易日</div><div class="tm">' + hms(S.t) + '</div><div class="p">' + ph.name + (S.running ? '' : ' · 已暂停') + '</div>';
}
const JUMPS = [[T(9, 20), '9:20', '竞价·不可撤'], [T(9, 25), '9:25', '开盘撮合'], [T(9, 30), '9:30', '连续竞价'], [T(11, 30), '11:30', '午间休市'], [T(13, 0), '13:00', '下午开盘'], [T(14, 57), '14:57', '收盘竞价'], [T(15, 0), '15:00', '收盘'], [T(15, 5), '15:05', '盘后交易'], [T(15, 30), '15:30', '日终清算']];
function jump(t) {
  if (t > S.t) advanceTo(t); else gotoNextDay(t);
  dirty = true; renderClock(); refresh();
}
function renderConsole() {
  $('#console').innerHTML = '<h2>原型控制台</h2><div class="lead">手机外的部分，只为了演示时间和规则。真实 App 没有这块。</div><div class="clk" id="cclock"></div>' +
    '<div class="bar"><button id="cplay" onclick="S.running=!S.running;renderConsole()">' + (S.running ? '暂停' : '继续') + '</button>' + [1, 10, 60, 300].map(v => '<button class="' + (S.speed === v ? 'on' : '') + '" onclick="S.speed=' + v + ';renderConsole()">' + v + '×</button>').join('') + '</div>' +
    '<h3>快进到（早于当前时间则进入下一交易日）</h3><div class="jump">' + JUMPS.map(([t, l, d]) => '<button onclick="jump(' + t + ')">' + l + '<small>' + d + '</small></button>').join('') + '<button onclick="jump(' + T(9, 15) + ')">下一交易日<small>9:15 开盘竞价</small></button></div>' +
    '<h3>页面</h3><div class="pages" id="cpages"></div>' +
    '<h3>建议的体验路线</h3><p>1. 交易 → 持仓：宁德时代今天买的，可用为 0（T+1）。<br>2. 查询 → 当日委托：招商银行卖单是废单（价格笼子），平安银行挂单在排队，试着撤单。<br>3. 买入沪深300ETF，跳到「下一交易日 9:15」再快进到 9:25，看集合竞价成交和学习进度自动打勾。<br>4. 卖出招商银行，下一交易日交割单出现「股息红利税补」。<br>5. 学习 → 账户分析、数据练习、数据中心。<br>6. 个股页 → 问 AI。</p>' +
    '<h3>数据说明</h3><p>行情来自腾讯接口 ' + DATA.fetchedAt + ' 抓取的快照、分时和日线（2026-10-26 上午为真实数据，之后为模拟走势）。示例账户的入金、成交是虚构的，招商银行的分红为示例数据。AI 回复是本地模板，不联网。刷新页面会重置。</p>';
  renderClock(); renderConsolePages();
}
const PAGE_LIST = [['自选', "tab('watch')"], ['行情', "tab('market')"], ['个股', "go('stock',{code:'sh600519'})"], ['搜索', "go('search')"], ['交易', "tab('trade')"], ['买入', "go('order',{side:'B',code:'sh510300'})"], ['卖出', "go('order',{side:'S',code:'sh600036'})"], ['撤单', "go('order',{side:'C'})"], ['委托/成交', "go('orders',{tab:'today'})"], ['交割单', "go('orders',{tab:'ledger'})"], ['银证转账', "go('transfer')"], ['资金流水', "go('flows')"], ['盘后交易', "go('order',{side:'B',kind:'after',code:'sh600036'})"], ['学习', "tab('learn')"], ['阶段 0', "go('stage',{no:0})"], ['规则课', "go('lessons')"], ['费用计算器', "go('feeCalc')"], ['集合竞价演示', "go('auction')"], ['数据练习', "go('datalab')"], ['账户分析', "go('analysis')"], ['数据中心', "go('datacenter')"], ['模拟执行', "go('exec')"], ['AI 助手', "openAI(null,'sh600519')"], ['AI 服务', "go('aiServices')"], ['我的', "tab('me')"], ['费率', "go('fees')"], ['交割单校准', "go('calibrate')"]];
function renderConsolePages() { const el = $('#cpages'); if (!el) return; el.innerHTML = PAGE_LIST.map(([l, f]) => '<button onclick="' + f + '">' + l + '</button>').join(''); }

// ---------- 启动 ----------
seed();
renderConsole();
render(true);
// 支持 prototype.html#买入 这样的地址直接打开某个页面
(function () { const h = decodeURIComponent(location.hash.slice(1)); const it = PAGE_LIST.find(x => x[0] === h) || (window.__START && PAGE_LIST.find(x => x[0] === window.__START)); if (it) { const b = document.createElement('button'); b.setAttribute('onclick', it[1]); b.click(); } })();
realLast = performance.now();
setInterval(() => loop(performance.now()), 100);
