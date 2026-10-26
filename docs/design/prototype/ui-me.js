/* AShareSim 原型 · 我的 / AI / 设置 / 控制台 / 启动 */
'use strict';
SCREENS.me = {
  title: '我的', root: true,
  render() {
    const a = account();
    const it = (l, d, f) => '<div class="row tap" onclick="' + f + '"><span class="grow">' + l + '</span><span class="muted" style="font-size:12px">' + d + '</span><span class="chev"></span></div>';
    return '<div class="sec" style="padding:16px 14px;display:flex;gap:12px;align-items:center"><div style="width:48px;height:48px;border-radius:24px;background:#1F2329;color:#fff;display:grid;place-items:center;font-weight:700">BF</div><div class="grow"><div style="font-weight:600;font-size:16px">模拟账户 · 仅本机</div><div class="muted" style="font-size:12px">总资产 <span class="n">' + money(a.total) + '</span> · 净入金 <span class="n">' + money(S.depositTotal) + '</span> / ' + money(S.depositCap) + '</div></div></div>' +
      '<div class="sec">' + it('银证转账（模拟入金）', '上限 ' + (S.depositCap / 1e4) + ' 万', "go('transfer')") + it('资金流水', S.flows.length + ' 条', "go('flows')") + it('交割单', '可导出 CSV', "go('orders',{tab:'ledger'})") + '</div>' +
      '<div class="sec">' + it('费率与账户', '万' + (S.fee.rate * 1e4).toFixed(2) + (S.fee.mian5 ? ' 免五' : ' 最低5元'), "go('fees')") + it('交割单校准', S.checks['s0-e0'] ? '已校准' : '未校准 · 当前费率是占位值', "go('calibrate')") + '</div>' +
      '<div class="sec">' + it('AI 对话与记忆', S.ai.mem.length + ' 条记忆', "go('aiThreads')") + it('AI 服务', S.ai.services.find(s => s.id === S.ai.active).name + ' · ' + protoName(S.ai.services.find(s => s.id === S.ai.active).protocol), "go('aiServices')") + it('行情数据源', '腾讯 · 3 秒', "go('dataSource')") + it('外观', '浅色 · 红涨绿跌', "showToast('设置里可切换深色和「绿涨红跌」')") + '</div>' +
      '<div class="sec">' + it('重置模拟账户', '旧账户归档', "resetAcct()") + it('关于与免责声明', 'v0.1 原型', "go('about')") + '</div>';
  }
};
function resetAcct() { modal({ title: '重置模拟账户', body: '<div class="ink2" style="font-size:13px">当前账户的持仓、委托、交割单会归档（可以在「历史账户」里查看和导出），然后从 0 元开始，你需要重新模拟入金。原型里会恢复成示例账户。</div>', ok: '重置', onOk: () => { seed(); tab('trade'); showToast('已重置'); } }); }
SCREENS.fees = {
  title: '费率与账户',
  render() {
    const F = S.fee;
    const num = (k, l, mul, unit) => '<div class="row"><span class="grow">' + l + '</span><div class="fld" style="width:110px;height:32px"><input value="' + +(F[k] * mul).toFixed(4) + '" onchange="S.fee.' + k + '=parseFloat(this.value)/' + mul + ';logAct(\'setting\',\'修改' + l + '为 ' + '\'+this.value);refresh()"></div><span class="muted" style="width:28px;font-size:12px">' + unit + '</span></div>';
    const sw = (k, l, d) => '<div class="row tap" onclick="S.fee.' + k + '=!S.fee.' + k + ';logAct(\'setting\',\'' + l + (F[k] ? ' 关' : ' 开') + '\');refresh()"><div class="grow">' + l + '<div class="muted" style="font-size:11px">' + d + '</div></div><span class="ostat ' + (F[k] ? 'done' : '') + '">' + (F[k] ? '开' : '关') + '</span></div>';
    return (feeCalibrated() ? '' : '<div class="note warn" style="margin:10px">下面的佣金是占位默认值（万 2.5、最低 5 元）。费率以你的真实交割单为准：去「交割单校准」抄一条真实成交，App 会反推佣金率和是否免五，并直接更新这里。</div>') + '<div class="sec"><div class="sec-h">佣金 <small>以你开户券商的为准</small></div>' + num('rate', '股票佣金率', 1e4, '‱') + num('min', '股票最低佣金', 1, '元') + num('etfRate', 'ETF 佣金率', 1e4, '‱') + num('etfMin', 'ETF 最低佣金', 1, '元') + sw('mian5', '免五', '不设 5 元最低佣金（按 0.1 元起收）') + sw('regsSeparate', '规费另收', '默认经手费、证管费含在佣金里；有些券商单列') + sw('mergeOrder', '同一委托多笔成交合并计佣', '大多数券商按委托合并计算最低 5 元') + '</div>' +
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
  const dc = items[0][2] - items[0][1], etf = SEC[CAL_IN.code].board === 'etf';
  CAL_FIX = null;
  if (Math.abs(dc) >= 0.005) {
    const real = items[0][2], impl = real / amt * 1e4, atMin = real <= 5.0001 && real >= 4.995;
    if (atMin) tip = '你的交割单佣金正好 5 元，触发了最低 5 元，这条成交推不出佣金率。换一条成交金额 2 万元以上的交割单再试。';
    else { CAL_FIX = { key: etf ? 'etfRate' : 'rate', rate: Math.round(impl * 100) / 1e6, mian5: real < 4.995 || S.fee.mian5 }; tip = '你的交割单佣金相当于万 ' + fx(impl, 3) + (CAL_FIX.mian5 && !S.fee.mian5 ? '，而且低于 5 元，说明你的账户免五' : '') + '。<div style="margin-top:8px"><button class="btn lt sm" onclick="applyCal()">按这条交割单更新' + (etf ? ' ETF ' : '股票') + '佣金率（万 ' + fx(CAL_FIX.rate * 1e4, 2) + (CAL_FIX.mian5 ? '，免五' : '') + '）</button></div>'; }
  }
  $('#calout').innerHTML = '<div class="sec"><table class="t n"><tr><th>项目</th><th>App 计算</th><th>交割单</th><th></th></tr>' + items.map(i => '<tr><td>' + i[0] + '</td><td>' + money(i[1]) + '</td><td>' + money(i[2]) + '</td><td class="' + (Math.abs(i[1] - i[2]) < 0.005 ? 'ok' : 'no') + '">' + (Math.abs(i[1] - i[2]) < 0.005 ? '一致' : '差 ' + fx(i[2] - i[1], 2)) + '</td></tr>').join('') + '</table><div style="padding:10px 14px" class="' + (allOk ? 'ok' : 'ink2') + '">' + (allOk ? '全部一致。费率设置和你的券商对上了。' : tip) + '</div></div>';
  logAct('learn', '交割单校准：' + (allOk ? '佣金、印花税、过户费全部一致' : items.filter(i => Math.abs(i[1] - i[2]) >= 0.005).map(i => i[0]).join('、') + '不一致'));
  if (allOk) autoCheck('s0-e0', '费率已用真实交割单校准');
}
let CAL_FIX = null;
function applyCal() { S.fee[CAL_FIX.key] = CAL_FIX.rate; S.fee.mian5 = CAL_FIX.mian5; logAct('setting', '按真实交割单更新佣金率：万 ' + fx(CAL_FIX.rate * 1e4, 2) + (CAL_FIX.mian5 ? '，免五' : '')); showToast('费率已更新，重新比对'); doCalibrate(); }
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
    '<h3>建议的体验路线</h3><p>1. 交易 → 持仓：宁德时代今天买的，可用为 0（T+1）。<br>2. 查询 → 当日委托：招商银行卖单是废单（价格笼子），平安银行挂单在排队，试着撤单。<br>3. 买入沪深300ETF，跳到「下一交易日 9:15」再快进到 9:25，看集合竞价成交和学习进度自动打勾。<br>4. 卖出招商银行，下一交易日交割单出现「股息红利税补」。<br>5. 学习 → 账户分析、数据练习、数据中心。<br>6. 任意页面点右下角 AI：它知道你在哪个页面、刚做了什么。比如在当日委托页问「刚才那笔为什么是废单」，在买入页问「解释这个页面」。<br>7. 在 AI 里说「我打算每周一调仓」，它会记住；☰ 里能看到对话列表和 AI 记忆，「上下文」条能看到每次实际发了什么。</p>' +
    '<h3>数据说明</h3><p>行情来自腾讯接口 ' + DATA.fetchedAt + ' 抓取的快照、分时和日线（2026-10-26 上午为真实数据，之后为模拟走势）。示例账户的入金、成交是虚构的，招商银行的分红为示例数据。AI 回复是本地模板，不联网。刷新页面会重置。</p>';
  renderClock(); renderConsolePages();
}
const PAGE_LIST = [['自选', "tab('watch')"], ['行情', "tab('market')"], ['个股', "go('stock',{code:'sh600519'})"], ['搜索', "go('search')"], ['交易', "tab('trade')"], ['买入', "go('order',{side:'B',code:'sh510300'})"], ['卖出', "go('order',{side:'S',code:'sh600036'})"], ['撤单', "go('order',{side:'C'})"], ['委托/成交', "go('orders',{tab:'today'})"], ['交割单', "go('orders',{tab:'ledger'})"], ['银证转账', "go('transfer')"], ['资金流水', "go('flows')"], ['盘后交易', "go('order',{side:'B',kind:'after',code:'sh600036'})"], ['学习', "tab('learn')"], ['阶段 0', "go('stage',{no:0})"], ['规则课', "go('lessons')"], ['费用计算器', "go('feeCalc')"], ['集合竞价演示', "go('auction')"], ['数据练习', "go('datalab')"], ['账户分析', "go('analysis')"], ['数据中心', "go('datacenter')"], ['模拟执行', "go('exec')"], ['AI 助手', "openAI(null,'sh600519')"], ['AI 对话与记忆', "go('aiThreads')"], ['AI 记忆', "go('aiMemory')"], ['AI 上下文', "go('aiCtx')"], ['AI 服务', "go('aiServices')"], ['我的', "tab('me')"], ['费率', "go('fees')"], ['交割单校准', "go('calibrate')"]];
function renderConsolePages() { const el = $('#cpages'); if (!el) return; el.innerHTML = PAGE_LIST.map(([l, f]) => '<button onclick="' + f + '">' + l + '</button>').join(''); }

// ---------- 启动 ----------
seed();
renderConsole();
render(true);
// 支持 prototype.html#买入 这样的地址直接打开某个页面
(function () { const h = decodeURIComponent(location.hash.slice(1)); const it = PAGE_LIST.find(x => x[0] === h) || (window.__START && PAGE_LIST.find(x => x[0] === window.__START)); if (it) { const b = document.createElement('button'); b.setAttribute('onclick', it[1]); b.click(); } })();
realLast = performance.now();
setInterval(() => loop(performance.now()), 100);
