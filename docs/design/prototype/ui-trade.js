/* AShareSim 原型 · 交易 */
'use strict';
function acctCard() {
  const a = account();
  return '<div class="acct"><div class="lbl">总资产（元）· 模拟账户</div><div class="tot n">' + money(a.total) + '</div>' +
    '<div class="g"><div>浮动盈亏<b class="n ' + cls(a.pnl) + '">' + sgn(a.pnl) + '</b></div><div>当日参考盈亏<b class="n ' + cls(a.todayPnl) + '">' + sgn(a.todayPnl) + '</b></div><div>总市值<b class="n">' + money(a.mv) + '</b></div>' +
    '<div>可用<b class="n">' + money(a.available) + '</b></div><div>可取<b class="n">' + money(Math.max(0, a.withdrawable)) + '</b></div><div>冻结<b class="n">' + money(a.frozen) + '</b></div></div></div>';
}
function posList(onTap) {
  const ps = positions();
  if (!ps.length) return '<div class="empty">还没有持仓。去买入第一笔吧。</div>';
  return '<div class="phead"><div>名称/市值</div><div>盈亏/盈亏率</div><div>持仓/可用</div><div>成本/现价</div></div>' + ps.map(p => {
    const s = SEC[p.code], k = cls(p.pnl);
    return '<div class="prow" onclick="' + (onTap ? onTap(p) : "posSheet('" + p.code + "')") + '"><div><b>' + s.name + '</b>' + tags(p.code) + '<small class="n">' + money(p.mv) + '</small></div>' +
      '<div class="n ' + k + '">' + sgn(p.pnl) + '<small class="' + k + '">' + pctS(p.pnlPct) + '</small></div>' +
      '<div class="n">' + intf(p.qty) + '<small>' + intf(p.sellable) + (p.todayBuy ? ' · T+1' : '') + '</small></div>' +
      '<div class="n">' + fx(p.costPx, 3) + '<small class="' + cls(p.px - p.costPx) + '">' + px(p.code, p.px) + '</small></div></div>';
  }).join('');
}
function posSheet(code) {
  const s = SEC[code];
  sheet(s.name + ' ' + s.sym,
    '<div class="row" onclick="closeOverlay();go(\'order\',{side:\'B\',code:\'' + code + '\'})"><span class="bs B">买</span>买入</div>' +
    '<div class="row" onclick="closeOverlay();go(\'order\',{side:\'S\',code:\'' + code + '\'})"><span class="bs S">卖</span>卖出</div>' +
    '<div class="row" onclick="closeOverlay();go(\'stock\',{code:\'' + code + '\'})">行情</div>' +
    '<div class="row" onclick="closeOverlay();openAI(\'company\',\'' + code + '\')">问 AI</div>' +
    '<div class="row" onclick="closeOverlay()" style="justify-content:center;color:var(--ink3)">取消</div>');
}
SCREENS.trade = {
  title: '交易', root: true, liveRefresh: true,
  navRight: () => '<span class="muted" style="font-size:12px;padding-right:10px">模拟 · 本地</span>',
  render() {
    const g = [['买入', 'var(--up)', '买', "go('order',{side:'B'})"], ['卖出', 'var(--sell)', '卖', "go('order',{side:'S'})"], ['撤单', '#E07800', '撤', "go('order',{side:'C'})"], ['持仓', '#5B6CF0', '持', "go('positions')"], ['查询', '#0F7B76', '查', "go('orders',{tab:'today'})"],
      ['交割单', '#7C3AED', '交', "go('orders',{tab:'ledger'})"], ['银证转账', '#C2410C', '转', "go('transfer')"], ['资金流水', '#0369A1', '流', "go('flows')"], ['盘后交易', '#5C626B', '盘', "go('order',{side:'B',kind:'after'})"], ['费率设置', '#9AA0A8', '费', "go('fees')"]];
    return phaseBar() + acctCard() + '<div class="grid5">' + g.map(([l, c, i, f]) => '<button onclick="' + f + '"><i style="background:' + c + '">' + i + '</i>' + l + '</button>').join('') + '</div>' +
      '<div class="sec"><div class="sec-h">持仓 <small>点一行买卖</small></div>' + posList() + '</div>' +
      '<div class="note" style="margin:0 10px 14px">除了入金是模拟的，下单规则、成交和费用都按真实规则计算。成交偏保守：涨停排队、同价排队都按估计的队列位置处理。</div>';
  },
  tick() { const v = $('#view'); const st = v.scrollTop; v.innerHTML = this.render(); v.scrollTop = st; }
};

// ---------- 下单 ----------
const OF = { price: null, qty: '', kind: 'limit', showFee: false };
let lastOrderKey = '';
SCREENS.order = {
  title: p => p.side === 'C' ? '撤单' : (p.kind === 'after' ? '盘后固定价格' : p.side === 'B' ? '买入' : '卖出'),
  fab: false,
  render(p) {
    const key = (p.code || '') + p.side + (p.kind || '');
    if (key !== lastOrderKey) { lastOrderKey = key; OF.price = p.price || null; OF.qty = ''; OF.kind = p.kind || 'limit'; OF.showFee = false; }
    const tabs = '<div class="seg">' + [['B', '买入'], ['S', '卖出'], ['C', '撤单'], ['P', '持仓']].map(([k, l]) => '<button class="' + (p.side === k ? 'on' : '') + '" style="' + (p.side === k && k === 'S' ? 'border-color:var(--sell)' : '') + '" onclick="cur().p.side=\'' + k + '\';cur().p.kind=null;refresh()">' + l + '</button>').join('') + '</div>';
    if (p.side === 'C') return tabs + phaseBar() + cancelList();
    if (p.side === 'P') return tabs + posList(pp => "cur().p.side='S';cur().p.code='" + pp.code + "';refresh()");
    if (!p.code) p.code = p.side === 'S' ? ((positions()[0] || {}).code || 'sh600519') : 'sh600519';
    const code = p.code, s = SEC[code];
    if (s.board === 'index') { p.code = 'sh510300'; return this.render(p); }
    const sn = snap(code, S.t);
    if (OF.price == null) OF.price = p.side === 'B' ? ((sn.asks[0] || sn.bids[0] || [sn.price])[0]) : ((sn.bids[0] || sn.asks[0] || [sn.price])[0]);
    const types = OF.kind === 'after' ? [['after', '盘后固定价格（收盘价）']] : MKT_TYPES[s.ex];
    const isB = p.side === 'B';
    let h = tabs + phaseBar() + '<div class="otk"><div class="form">';
    h += '<div class="fld stock" onclick="go(\'search\',{pick:1})"><span><b>' + s.name + '</b> <span class="n muted">' + s.sym + '</span>' + tags(code) + '</span><span class="chev"></span></div>';
    h += '<div class="fld"><select onchange="OF.kind=this.value;refresh()" aria-label="委托类型">' + types.map(([k, l]) => '<option value="' + k + '"' + (OF.kind === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>';
    if (OF.kind === 'limit') {
      h += '<div class="fld"><button onclick="stepPrice(-1)" aria-label="减价">−</button><input id="ip" inputmode="decimal" value="' + fx(OF.price, s.dec) + '" onchange="OF.price=parseFloat(this.value);SCREENS.order.live()"><button onclick="stepPrice(1)" aria-label="加价">＋</button></div>';
      h += '<div class="hint"><span>跌停 <b class="n down" style="cursor:pointer" onclick="OF.price=' + MK[code].down + ';refresh()">' + px(code, MK[code].down) + '</b></span><span>涨停 <b class="n up" style="cursor:pointer" onclick="OF.price=' + MK[code].up + ';refresh()">' + px(code, MK[code].up) + '</b></span></div>';
      h += '<div class="hint" id="cagehint"></div>';
    } else h += '<div class="fld" style="justify-content:center;color:var(--ink2);font-size:13px">' + (OF.kind === 'after' ? '按当日收盘价成交' : '市价：按对手盘成交，' + (isB ? '冻结按涨停价' : '')) + '</div>';
    h += '<div class="fld"><button onclick="stepQty(-1)" aria-label="减量">−</button><input id="iq" inputmode="numeric" placeholder="' + (isB ? '买入' : '卖出') + '数量" value="' + OF.qty + '" oninput="OF.qty=this.value;SCREENS.order.live()"><button onclick="stepQty(1)" aria-label="加量">＋</button></div>';
    h += '<div class="hint" id="canq"></div>';
    h += '<div class="quick">' + [['全仓', 1], ['1/2', 2], ['1/3', 3], ['1/4', 4]].map(([l, d]) => '<button onclick="quickQty(' + d + ')">' + l + '</button>').join('') + '</div>';
    h += '<div id="feebox"></div>';
    h += '<button class="btn block ' + (isB ? 'buy' : 'sell') + '" onclick="submitOrder()" style="height:44px;font-size:16px">' + (isB ? '买入' : '卖出') + '</button>';
    h += '</div><div class="bk" id="obook">' + bookHTML(code, true, 'setPrice') + '</div></div>';
    h += '<div class="sec" style="margin-top:8px"><div class="sec-h">' + (isB ? '持仓' : '可卖持仓') + '</div><div id="opos">' + posList(pp => "cur().p.code='" + pp.code + "';OF.price=null;OF.qty='';lastOrderKey='';refresh()") + '</div></div>';
    return h;
  },
  after(p) { if (p.side === 'B' || p.side === 'S') this.live(); },
  live() {
    const p = cur().p; if (!(p.side === 'B' || p.side === 'S')) return;
    const code = p.code, s = SEC[code], sn = snap(code, S.t), isB = p.side === 'B', ph = phaseAt(S.t);
    const ch = $('#cagehint');
    if (ch) { const c = cageRange(code, p.side, sn); ch.innerHTML = ph === 'cont' && c ? '<span>价格笼子：' + (isB ? '买入价 ≤ <b class="n">' + px(code, c.max) + '</b>' : '卖出价 ≥ <b class="n">' + px(code, c.min) + '</b>') + '</span>' : ''; if (ph === 'cont' && c && OF.kind === 'limit' && ((isB && OF.price > c.max) || (!isB && OF.price < c.min))) ch.innerHTML += '<span class="no">超出范围</span>'; }
    const cq = $('#canq');
    if (cq) {
      if (isB) { const mx = maxBuy(code); cq.innerHTML = '<span>可买 <b class="n">' + intf(mx) + '</b> ' + unitName(code) + '</span><span>可用 <span class="n">' + money(S.cash - S.frozen) + '</span></span>'; }
      else { const a = availableQty(code); cq.innerHTML = '<span>可卖 <b class="n">' + intf(a.sellable) + '</b> ' + unitName(code) + '</span>' + (a.todayBuy ? '<span class="no">T+1 冻结 ' + intf(a.todayBuy) + '</span>' : '<span></span>'); }
    }
    const fb = $('#feebox');
    if (fb) {
      const q = parseInt(OF.qty) || 0;
      const pr = OF.kind === 'limit' ? OF.price : OF.kind === 'after' ? (MK[code].close || sn.price) : (isB ? (sn.asks[0] || [sn.price])[0] : (sn.bids[0] || [sn.price])[0]);
      const amt = r2(pr * q), f = calcFee(code, p.side, amt);
      let t = '<div class="feeline" onclick="OF.showFee=!OF.showFee;SCREENS.order.live()"><span>金额 <b class="n">' + money(amt) + '</b></span><span>费用约 <b class="n">' + money(f.total) + '</b> ' + (OF.showFee ? '▴' : '▾') + '</span></div>';
      if (OF.showFee) {
        t += '<div class="feebox n"><span>佣金 ' + (S.fee.mian5 ? '（免五）' : '（最低 ' + (s.board === 'etf' ? S.fee.etfMin : S.fee.min) + ' 元）') + '</span><span>' + money(f.commission) + '</span>' +
          '<span>印花税（' + (s.board === 'etf' ? 'ETF 免征' : isB ? '买入不收' : '0.05%') + '）</span><span>' + money(f.stamp) + '</span>' +
          '<span>过户费（' + (s.board === 'etf' ? 'ETF 免收' : '0.001%') + '）</span><span>' + money(f.transfer) + '</span>' +
          (S.fee.regsSeparate ? '<span>经手费</span><span>' + money(f.handling) + '</span><span>证管费</span><span>' + money(f.reg) + '</span>' : '<span class="muted">经手费、证管费</span><span class="muted">含在佣金里</span>') + '</div>';
        if (!feeCalibrated()) t += '<div class="muted" style="font-size:11px;margin-top:4px">费率还没用真实交割单校准，佣金按占位默认值估算。<a style="color:var(--learn)" onclick="go(\'calibrate\')">去校准</a></div>';
        if (!isB) { const lots = S.lots.filter(l => l.code === code && l.div > 0); if (lots.length) { const tr = divTaxRate(lots[0].date, today()); t += '<div class="note warn" style="margin-top:4px">这只股票持有期间分过红，卖出后下一交易日补扣股息红利税（' + tr.label + '）。</div>'; } }
      }
      fb.innerHTML = t;
    }
  },
  tick(p) {
    if (p.side === 'C') { const v = $('#view'); const st = v.scrollTop; v.innerHTML = this.render(p); v.scrollTop = st; return; }
    if (!(p.side === 'B' || p.side === 'S')) return;
    const ob = $('#obook'); if (ob) ob.innerHTML = bookHTML(p.code, true, 'setPrice');
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    this.live();
    const op = $('#opos'); if (op) op.innerHTML = posList(pp => "cur().p.code='" + pp.code + "';OF.price=null;OF.qty='';lastOrderKey='';refresh()");
  }
};
function setPrice(v) { OF.price = v; if (OF.kind !== 'limit') OF.kind = 'limit'; const ip = $('#ip'); if (ip) { ip.value = fx(v, SEC[cur().p.code].dec); SCREENS.order.live(); } else refresh(); }
function stepPrice(d) { const s = SEC[cur().p.code]; OF.price = roundTo((OF.price || 0) + d * s.tick, s.tick); $('#ip').value = fx(OF.price, s.dec); SCREENS.order.live(); }
function stepQty(d) { const p = cur().p, s = SEC[p.code]; let q = parseInt(OF.qty) || 0; const u = s.board === 'kcb' && q < 200 && d > 0 ? 200 : 100; q = Math.max(0, q + d * u); OF.qty = q ? String(q) : ''; $('#iq').value = OF.qty; SCREENS.order.live(); }
function maxBuy(code) {
  const s = SEC[code], sn = snap(code, S.t);
  const pr = OF.kind === 'limit' ? OF.price : OF.kind === 'after' ? (MK[code].close || sn.price) : MK[code].up;
  const av = S.cash - S.frozen; if (!(pr > 0)) return 0;
  let q = Math.floor(av / pr / 100) * 100;
  while (q > 0 && freezeAmount(code, 'B', OF.kind, pr, q) > av) q -= 100;
  if (s.board === 'kcb') { q = Math.floor(av / pr); while (q > 0 && freezeAmount(code, 'B', OF.kind, pr, q) > av) q--; if (q < 200) q = 0; }
  return Math.max(0, q);
}
function quickQty(div) {
  const p = cur().p, s = SEC[p.code];
  let q;
  if (p.side === 'B') { q = maxBuy(p.code); q = s.board === 'kcb' ? Math.floor(q / div) : Math.floor(q / div / 100) * 100; if (s.board === 'kcb' && q < 200) q = 0; }
  else { const a = availableQty(p.code); q = div === 1 ? a.sellable : Math.floor(a.sellable / div / 100) * 100; }
  OF.qty = q ? String(q) : ''; $('#iq').value = OF.qty; SCREENS.order.live();
}
function sendTimeText(ph, kind) {
  if (kind === 'after') return ph === 'after' ? '现在是盘后固定价格交易时段，提交后按收盘价撮合。' : '15:05–15:30 按当日收盘价撮合。';
  return { pre: '现在还没开盘，这是预埋单，券商会在 9:15 报送交易所。', auc1: '现在是开盘集合竞价，9:25 统一撮合。9:20 前还可以撤单。', auc2: '现在是 9:20–9:25，提交后不能撤单，9:25 统一撮合。', wait: '9:25–9:30 交易所不接收申报，券商会在 9:30 报送。', cont: '提交后立即报送，按价格优先、时间优先撮合。', lunch: '午间休市，券商暂存，13:00 报送。', cauc: '收盘集合竞价阶段，提交后不能撤单，15:00 统一撮合。', closed1: '今天已收盘，这笔委托会在下一交易日 9:15 报送。', after: '今天已收盘，这笔委托会在下一交易日 9:15 报送。', closed: '今天已收盘，这笔委托会在下一交易日 9:15 报送。' }[ph];
}
function submitOrder(force) {
  const p = cur().p, s = SEC[p.code];
  const ip = $('#ip'); if (ip) OF.price = parseFloat(ip.value);
  const o = { code: p.code, side: p.side, kind: OF.kind, price: OF.kind === 'limit' ? roundTo(OF.price, 0.0001) : null, qty: parseInt(OF.qty) || 0 };
  const v = validateOrder(o);
  if (!v.ok && v.level === 'block') { logAct('reject', '下单被拦截：' + ordText(o) + ' → ' + v.rule, { rule: v.rule, msg: v.msg, lesson: v.lesson }); return ruleError(v); }
  const ph = phaseAt(S.t);
  const amt = OF.kind === 'limit' ? o.price * o.qty : (OF.kind === 'after' ? (MK[p.code].close || lastPx(p.code)) : lastPx(p.code)) * o.qty;
  const f = calcFee(p.code, p.side, r2(amt));
  const body = '<div class="ckv"><span>操作</span><span class="' + (p.side === 'B' ? 'up' : '') + '" style="' + (p.side === 'S' ? 'color:var(--sell)' : '') + '">' + (p.side === 'B' ? '买入' : '卖出') + '</span><span>证券</span><span>' + s.name + ' ' + s.sym + '</span><span>委托类型</span><span>' + (types => types.find(t => t[0] === OF.kind) || ['', '盘后固定价格'])(MKT_TYPES[s.ex])[1] + '</span>' +
    '<span>价格</span><span class="n">' + (OF.kind === 'limit' ? px(p.code, o.price) : OF.kind === 'after' ? '收盘价' : '市价') + '</span><span>数量</span><span class="n">' + intf(o.qty) + ' ' + unitName(p.code) + '</span><span>预估金额</span><span class="n">' + money(amt) + '</span><span>预估费用</span><span class="n">' + money(f.total) + '</span></div>' +
    '<div class="note" style="margin-top:10px">' + sendTimeText(ph, OF.kind) + '</div>' +
    (!v.ok && v.level === 'warn' ? '<div class="note warn" style="margin-top:6px"><b>价格笼子：</b>' + esc(v.msg) + '</div>' : '');
  modal({
    title: '委托确认', body, ok: !v.ok ? '仍然提交' : '确认' + (p.side === 'B' ? '买入' : '卖出'), okCls: p.side,
    onOk: () => {
      const r = placeOrder(o, true);
      if (!r.ok) return ruleError(r);
      showToast('委托已提交，合同号 ' + r.order.no + (r.order.status === '废单' ? '（废单）' : ''), r.order.status === '废单' ? '' : 'info');
      OF.qty = ''; refresh();
    }
  });
}
function cancelList() {
  const live = S.orders.filter(isLive);
  if (!live.length) return '<div class="empty">没有可撤的委托</div>';
  return '<div style="display:flex;gap:8px;padding:8px 14px;background:#fff;border-bottom:1px solid var(--line)"><button class="btn sm ghost" onclick="cancelMany(o=>true)">全撤</button><button class="btn sm ghost" onclick="cancelMany(o=>o.side===\'B\')">撤买</button><button class="btn sm ghost" onclick="cancelMany(o=>o.side===\'S\')">撤卖</button></div>' +
    live.map(o => orderRow(o, true)).join('');
}
function cancelMany(f) {
  const live = S.orders.filter(o => isLive(o) && f(o)); let ok = 0, msg = '';
  for (const o of live) { const r = cancelOrder(o); if (r.ok) ok++; else msg = r.msg; }
  showToast(ok ? '已撤 ' + ok + ' 笔' : msg || '没有可撤的委托'); refresh();
}
function doCancel(id) {
  const o = S.orders.find(x => x.id === id);
  modal({ title: '撤单确认', body: '<div class="ckv"><span>证券</span><span>' + SEC[o.code].name + '</span><span>方向</span><span>' + (o.side === 'B' ? '买入' : '卖出') + '</span><span>委托</span><span class="n">' + (o.price ? px(o.code, o.price) : '市价') + ' × ' + intf(o.qty) + '</span><span>已成交</span><span class="n">' + intf(o.filled) + '</span></div>', ok: '确认撤单', onOk: () => { const r = cancelOrder(o); if (!r.ok) return ruleError({ rule: '现在不能撤单', msg: r.msg, lesson: r.lesson }); showToast('撤单成功'); refresh(); } });
}
function statusCls(st) { return st === '已成' ? 'done' : ['已报', '部成', '未报'].includes(st) ? 'live' : st === '废单' ? 'bad' : ''; }
function orderRow(o, withCancel) {
  const s = SEC[o.code];
  return '<div class="orow" onclick="go(\'orderDetail\',{id:' + o.id + '})"><div class="l1"><span><span class="bs ' + o.side + '">' + (o.side === 'B' ? '买' : '卖') + '</span><b style="font-weight:500">' + s.name + '</b> <span class="muted n" style="font-size:11px">' + s.sym + '</span></span><span>' +
    (withCancel ? '<button class="btn sm ghost" onclick="event.stopPropagation();doCancel(' + o.id + ')">撤单</button>' : '<span class="ostat ' + statusCls(o.status) + '">' + o.status + '</span>') + '</span></div>' +
    '<div class="l2 n"><span>' + (o.di === S.di ? '' : CAL[o.di].slice(5) + ' ') + hms(o.t) + ' · ' + KIND_NAME[o.kind] + '</span><span>委托 ' + (o.price != null ? px(o.code, o.price) : '市价') + ' × ' + intf(o.qty) + '</span><span>成交 ' + (o.filled ? px(o.code, o.amt / o.filled) + ' × ' + intf(o.filled) : '0') + '</span></div>' +
    (o.reason || o.note ? '<div class="muted" style="font-size:11px;margin-top:3px">' + esc(o.reason || o.note) + '</div>' : '') + '</div>';
}
SCREENS.positions = { title: '持仓', liveRefresh: true, render() { return acctCard() + '<div class="hr"></div>' + posList(); }, tick() { const v = $('#view'); const st = v.scrollTop; v.innerHTML = this.render(); v.scrollTop = st; } };
SCREENS.orders = {
  title: '查询', liveRefresh: true,
  render(p) {
    const tb = p.tab || 'today';
    let h = '<div class="seg">' + [['today', '当日委托'], ['fills', '当日成交'], ['hist', '历史委托'], ['ledger', '交割单']].map(([k, l]) => '<button class="' + (tb === k ? 'on' : '') + '" onclick="cur().p.tab=\'' + k + '\';refresh()">' + l + '</button>').join('') + '</div>';
    if (tb === 'today') { const os = S.orders.filter(o => o.di === S.di || (o.nextDay && isLive(o))); h += os.length ? os.map(o => orderRow(o)).join('') : '<div class="empty">今天还没有委托</div>'; }
    if (tb === 'hist') { const os = S.orders.filter(o => o.di < S.di && !(o.nextDay && isLive(o))); h += os.map(o => orderRow(o)).join('') || '<div class="empty">没有历史委托</div>'; }
    if (tb === 'fills') { const fs = S.fills.filter(f => f.di === S.di); h += fs.length ? fs.map(fillRow).join('') : '<div class="empty">今天还没有成交</div>'; }
    if (tb === 'ledger') h += ledgerHTML();
    return h;
  }
};
function fillRow(f) {
  const s = SEC[f.code];
  return '<div class="orow" onclick="go(\'fillDetail\',{id:' + f.id + '})"><div class="l1"><span><span class="bs ' + f.side + '">' + (f.side === 'B' ? '买' : '卖') + '</span><b style="font-weight:500">' + s.name + '</b></span><span class="n">' + hms(f.t) + '</span></div><div class="l2 n"><span>' + px(f.code, f.price) + ' × ' + intf(f.qty) + '</span><span>金额 ' + money(f.amount) + '</span><span>费用 ' + money(f.fee.total) + '</span></div><div class="muted" style="font-size:11px;margin-top:3px">' + esc(f.basis) + '</div></div>';
}
function ledgerHTML() {
  const rows = S.ledger;
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:#fff;border-bottom:1px solid var(--line)"><span class="muted" style="font-size:12px">共 ' + rows.length + ' 条 · 左右滑动看全部列</span><button class="btn sm ghost" onclick="exportLedger()">导出 CSV</button></div>' +
    '<div class="scroll-x" style="background:#fff"><table class="t n"><tr><th>日期</th><th>业务</th><th>证券</th><th>成交价</th><th>数量</th><th>成交金额</th><th>佣金</th><th>印花税</th><th>过户费</th>' + (S.fee.regsSeparate ? '<th>经手费</th><th>证管费</th>' : '') + '<th>红利税</th><th>发生金额</th><th>资金余额</th></tr>' +
    rows.map(l => '<tr onclick="ledgerTap(' + l.id + ')" style="cursor:pointer"><td>' + l.date.slice(5) + '</td><td style="text-align:left">' + l.biz + '</td><td style="text-align:left">' + l.name + '</td><td>' + (l.price ? px(l.code, l.price) : '') + '</td><td>' + (l.qty ? intf(l.qty) : '') + '</td><td>' + (l.amount ? money(l.amount) : '') + '</td><td>' + money(l.commission) + '</td><td>' + money(l.stamp) + '</td><td>' + money(l.transfer) + '</td>' + (S.fee.regsSeparate ? '<td>' + money(l.handling) + '</td><td>' + money(l.reg) + '</td>' : '') + '<td>' + money(l.divTax || 0) + '</td><td class="' + cls(l.net) + '">' + sgn(l.net) + '</td><td>' + money(l.balance) + '</td></tr>').join('') + '</table></div>';
}
function ledgerTap(id) {
  const l = S.ledger.find(x => x.id === id); if (!l) return;
  const f = S.fills.find(x => x.id === id);
  if (f) return go('fillDetail', { id });
  modal({ title: l.biz, cancel: false, ok: '知道了', body: '<div class="ckv"><span>日期</span><span>' + l.date + '</span><span>证券</span><span>' + l.name + '</span><span>发生金额</span><span class="n ' + cls(l.net) + '">' + sgn(l.net) + '</span></div><div class="note" style="margin-top:8px">' + esc(l.note || '') + '</div>', extra: [{ label: '问 AI', fn: () => openAI('fee') }] });
}
function exportLedger() {
  const head = ['日期', '时间', '业务', '代码', '名称', '成交价', '数量', '成交金额', '佣金', '印花税', '过户费', '经手费', '证管费', '股息红利税', '发生金额', '资金余额', '合同号'];
  const lines = [head.join(',')].concat(S.ledger.slice().reverse().map(l => [l.date, hms(l.t), l.biz, SEC[l.code].sym, l.name, l.price || '', l.qty || '', l.amount || '', l.commission, l.stamp, l.transfer, l.handling || 0, l.reg || 0, l.divTax || 0, l.net, l.balance, l.no].join(',')));
  download('交割单_' + today() + '.csv', '﻿' + lines.join('\n'));
}
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); showToast('已导出 ' + name); logAct('export', '导出 ' + name); }
SCREENS.orderDetail = {
  title: '委托详情', liveRefresh: true,
  render(p) {
    const o = S.orders.find(x => x.id === p.id), s = SEC[o.code];
    let h = '<div class="sec" style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center"><span><span class="bs ' + o.side + '">' + (o.side === 'B' ? '买' : '卖') + '</span><b>' + s.name + '</b> <span class="muted n">' + s.sym + '</span></span><span class="ostat ' + statusCls(o.status) + '">' + o.status + '</span></div>' +
      '<div class="ckv" style="margin-top:10px;font-size:13px"><span>合同号</span><span class="n">' + o.no + '</span><span>委托类型</span><span>' + KIND_NAME[o.kind] + '</span><span>委托价 × 数量</span><span class="n">' + (o.price != null ? px(o.code, o.price) : '市价') + ' × ' + intf(o.qty) + '</span><span>成交均价 × 数量</span><span class="n">' + (o.filled ? px(o.code, o.amt / o.filled) : '--') + ' × ' + intf(o.filled) + '</span><span>成交金额</span><span class="n">' + money(o.amt) + '</span><span>费用合计</span><span class="n">' + money(o.fee.total) + '</span>' + (o.side === 'B' ? '<span>冻结资金</span><span class="n">' + money(o.frozen) + '</span>' : '') + '</div>' +
      (isLive(o) ? '<button class="btn block ghost" style="margin-top:10px" onclick="doCancel(' + o.id + ')">撤单</button>' : '') + '</div>';
    h += '<div class="sec"><div class="sec-h">过程</div><div class="tl"><div class="e"><b>提交委托</b><small>' + CAL[o.di] + ' ' + hms(o.t) + ' · ' + PHASES[phaseAt(o.t)].name + '</small></div>';
    if (o.status === '废单') h += '<div class="e f"><b>废单</b><small>' + esc(o.reason) + '</small></div>';
    for (const fid of o.fills) { const f = S.fills.find(x => x.id === fid); h += '<div class="e f" onclick="go(\'fillDetail\',{id:' + f.id + '})" style="cursor:pointer"><b>成交 ' + px(o.code, f.price) + ' × ' + intf(f.qty) + '</b><small>' + esc(f.basis) + '</small></div>'; }
    if (isLive(o)) h += '<div class="e"><b>' + o.status + '</b><small>' + esc(o.note || '') + '</small></div>';
    if (['已撤', '部撤'].includes(o.status)) h += '<div class="e"><b>' + o.status + '</b><small>' + esc(o.reason) + '</small></div>';
    h += '</div></div>';
    return h;
  }
};
SCREENS.fillDetail = {
  title: '成交详情',
  render(p) {
    const f = S.fills.find(x => x.id === p.id), s = SEC[f.code];
    const sideT = f.side === 'B' ? '买入' : '卖出', fe = f.fee;
    const rate = s.board === 'etf' ? S.fee.etfRate : S.fee.rate, min = S.fee.mian5 ? 0.1 : (s.board === 'etf' ? S.fee.etfMin : S.fee.min);
    let h = '<div class="sec" style="padding:12px 14px"><div><span class="bs ' + f.side + '">' + (f.side === 'B' ? '买' : '卖') + '</span><b>' + s.name + '</b> ' + sideT + ' ' + intf(f.qty) + unitName(f.code) + ' @ <b class="n">' + px(f.code, f.price) + '</b></div><div class="muted" style="font-size:12px;margin-top:4px">' + CAL[f.di] + ' ' + hms(f.t) + ' · 成交编号 ' + f.no + '</div></div>';
    h += '<div class="sec"><div class="sec-h">成交依据</div><div class="note" style="margin:0 14px 12px">' + esc(f.basis) + '</div></div>';
    h += '<div class="sec"><div class="sec-h">费用怎么算</div><div style="padding:0 14px 12px;font-size:13px;line-height:1.9" class="n">' +
      '成交金额 = ' + px(f.code, f.price) + ' × ' + intf(f.qty) + ' = <b>' + money(f.amount) + '</b><br>' +
      '佣金 = max(金额 × ' + (rate * 10000).toFixed(2) + '‱, ' + min + ' 元) = <b>' + money(fe.commission) + '</b>' + (S.fee.mergeOrder ? '<span class="muted">（同一委托多笔成交合并计算）</span>' : '') + '<br>' +
      '印花税 = ' + (s.board === 'etf' ? 'ETF 免征' : f.side === 'B' ? '买入不收' : '金额 × 0.05%') + ' = <b>' + money(fe.stamp) + '</b><br>' +
      '过户费 = ' + (s.board === 'etf' ? 'ETF 免收' : '金额 × 0.001%') + ' = <b>' + money(fe.transfer) + '</b><br>' +
      (S.fee.regsSeparate ? '经手费 ' + money(fe.handling) + '，证管费 ' + money(fe.reg) + '<br>' : '<span class="muted">经手费 0.00341% 和证管费 0.002% 已含在佣金里</span><br>') +
      '合计 <b>' + money(fe.total) + '</b>，' + (f.side === 'B' ? '资金减少' : '资金增加') + ' <b class="' + cls(f.net) + '">' + money(Math.abs(f.net)) + '</b>' +
      (f.divTaxPending ? '<div class="note warn" style="margin-top:6px">股息红利税 ' + money(f.divTaxPending) + ' 元将在下一交易日扣收：' + esc(f.divNotes.join('；')) + '</div>' : '') +
      '</div><div style="padding:0 14px 12px;display:flex;gap:8px"><button class="btn sm ghost" onclick="openAI(\'fee\')">让 AI 解释这笔费用</button><button class="btn sm ghost" onclick="go(\'lesson\',{id:\'fee\'})">费用规则课</button></div></div>';
    return h;
  }
};

// ---------- 银证转账 / 资金流水 ----------
let tfDir = 'in';
SCREENS.transfer = {
  title: '银证转账', liveRefresh: true,
  render() {
    const a = account();
    const left = r2(S.depositCap - S.depositTotal);
    return '<div class="seg">' + [['in', '银行转证券'], ['out', '证券转银行']].map(([k, l]) => '<button class="' + (tfDir === k ? 'on' : '') + '" onclick="tfDir=\'' + k + '\';refresh()">' + l + '</button>').join('') + '</div>' +
      '<div class="sec" style="padding:14px"><div class="ckv" style="font-size:13px"><span>转出</span><span>' + (tfDir === 'in' ? '模拟银行卡（工商银行 尾号 0000）' : '模拟证券账户') + '</span><span>转入</span><span>' + (tfDir === 'in' ? '模拟证券账户' : '模拟银行卡') + '</span>' +
      (tfDir === 'in' ? '<span>累计净入金</span><span class="n">' + money(S.depositTotal) + ' / ' + money(S.depositCap) + '</span><span>还可转入</span><span class="n">' + money(left) + '</span>' : '<span>可取资金</span><span class="n">' + money(Math.max(0, a.withdrawable)) + '</span>') + '</div>' +
      '<div class="fld" style="margin-top:12px;padding:0 10px"><input id="tfa" inputmode="decimal" placeholder="转账金额" style="text-align:left"></div>' +
      '<button class="btn block buy" style="margin-top:12px" onclick="doTransfer()">' + (tfDir === 'in' ? '转入' : '转出') + '</button>' +
      '<div class="note" style="margin-top:10px">这是 App 里唯一「模拟」的地方：钱是假的，其他一切按真实规则。转账时间按券商常见规则：交易日 9:00–16:00。卖出股票的钱当天可以再买，下一个交易日才能转出（可取 T+1）。累计净入金上限可在「我的 → 费率与账户」修改。</div></div>';
  }
};
function doTransfer() {
  const v = parseFloat($('#tfa').value);
  if (!(v > 0)) return ruleError({ rule: '金额', msg: '请输入转账金额。' });
  if (S.t < T(9, 0) || S.t > T(16, 0)) return ruleError({ rule: '银证转账时间', msg: '银证转账时间为交易日 9:00–16:00（各券商略有不同），现在是 ' + hms(S.t) + '。' });
  if (tfDir === 'in') {
    if (S.depositTotal + v > S.depositCap + 1e-6) return ruleError({ rule: '模拟入金上限', msg: '累计净入金上限 ' + money(S.depositCap) + ' 元，还可转入 ' + money(S.depositCap - S.depositTotal) + ' 元。' });
    deposit(r2(v)); showToast('已转入 ' + money(v) + ' 元');
  } else {
    const a = account();
    if (v > a.withdrawable + 1e-6) return ruleError({ rule: '可取资金不足', msg: '可取资金 ' + money(Math.max(0, a.withdrawable)) + ' 元。今天卖出的钱下一交易日才能取出，冻结资金不能取。' });
    withdraw(r2(v)); showToast('已转出 ' + money(v) + ' 元');
  }
  refresh();
}
SCREENS.flows = {
  title: '资金流水', liveRefresh: true,
  render() {
    return '<div style="background:#fff">' + S.flows.map(f => '<div class="row"><div class="grow"><b style="font-weight:500">' + f.kind + '</b><div class="muted" style="font-size:12px">' + f.date + ' ' + hms(f.t) + ' · ' + esc(f.note || '') + '</div></div><div style="text-align:right"><b class="n ' + cls(f.amount) + '">' + sgn(f.amount) + '</b><div class="muted n" style="font-size:12px">余额 ' + money(f.balance) + '</div></div></div>').join('') + '</div>';
  }
};
