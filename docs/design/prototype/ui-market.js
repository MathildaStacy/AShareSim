/* AShareSim 原型 · 自选 / 行情 / 个股 / 搜索 */
'use strict';
let watchSort = 0; // 0 默认 1 涨幅降 2 涨幅升
function quoteRow(code, onclick) {
  const sn = snap(code, S.t), s = SEC[code];
  const c = cls(sn.chg);
  return '<div class="qrow" onclick="' + (onclick || "go('stock',{code:'" + code + "'})") + '"><div class="nm"><b>' + esc(s.name) + '</b><small>' + s.sym + tags(code) + '</small></div>' +
    '<div class="px n ' + c + '">' + px(code, sn.price) + '</div><div class="pc"><span class="pill n ' + c + '">' + (sn.last == null ? '0.00%' : pctS(sn.pct)) + '</span></div></div>';
}
function idx3() {
  return '<div class="idx3">' + ['sh000001', 'sz399001', 'sz399006'].map(c => { const sn = snap(c, S.t); const k = cls(sn.chg); return '<button onclick="go(\'stock\',{code:\'' + c + '\'})"><div class="nm">' + SEC[c].name + '</div><div class="px n ' + k + '">' + fx(sn.price, 2) + '</div><div class="ch n ' + k + '">' + sgn(sn.chg, 2) + ' ' + pctS(sn.pct) + '</div></button>'; }).join('') + '</div>';
}
function phaseBar() {
  const ph = phaseLabel();
  return '<div class="phbar" onclick="go(\'lesson\',{id:\'time\'})"><span class="dot"></span><b>' + ph.name + '</b><span style="flex:1">' + esc(ph.desc) + '</span><span class="chev"></span></div>';
}
SCREENS.watch = {
  title: '自选', root: true, liveRefresh: false,
  navRight: () => '<button class="ib" onclick="go(\'search\')" aria-label="搜索">⌕</button>',
  render() {
    let list = S.watch.slice();
    if (watchSort) list.sort((a, b) => (snap(b, S.t).pct - snap(a, S.t).pct) * (watchSort === 1 ? 1 : -1));
    return idx3() + phaseBar() +
      '<div class="qhead"><span>名称代码</span><span>最新</span><span class="srt" onclick="watchSort=(watchSort+1)%3;refresh()">涨跌幅 ' + ['⇅', '↓', '↑'][watchSort] + '</span></div>' +
      '<div id="wl">' + list.map(c => quoteRow(c)).join('') + '</div>' +
      '<div style="padding:14px;text-align:center"><button class="btn ghost sm" onclick="go(\'search\')">＋ 添加自选</button></div>' +
      '<div class="note" style="margin:0 14px 14px">原型行情：2026-10-26 上午为腾讯接口抓取的真实数据，11:30 以后为模拟走势。右侧控制台可以快进时间。</div>';
  },
  tick() { const v = $('#view'); const st = v.scrollTop; v.innerHTML = this.render(); v.scrollTop = st; }
};
let mktSeg = 'idx';
SCREENS.market = {
  title: '行情', root: true,
  navRight: () => '<button class="ib" onclick="go(\'search\')" aria-label="搜索">⌕</button>',
  render() {
    const segs = [['idx', '指数'], ['main', '沪深主板'], ['cyb', '创业板'], ['kcb', '科创板'], ['etf', 'ETF']];
    let h = '<div class="seg">' + segs.map(([k, l]) => '<button class="' + (mktSeg === k ? 'on' : '') + '" onclick="mktSeg=\'' + k + '\';refresh()">' + l + '</button>').join('') + '</div>';
    if (mktSeg === 'idx') {
      h += '<div class="idxgrid">' + INDICES.map(c => { const sn = snap(c, S.t), k = cls(sn.chg); return '<button onclick="go(\'stock\',{code:\'' + c + '\'})"><div class="ink2" style="font-size:12px">' + SEC[c].name + '</div><div class="px n ' + k + '">' + fx(sn.price, 2) + '</div><div class="n ' + k + '" style="font-size:11px">' + sgn(sn.chg, 2) + ' ' + pctS(sn.pct) + '</div></button>'; }).join('') + '</div>';
      h += '<div class="sec" style="margin-top:8px"><div class="sec-h">这些指数分别代表什么</div><div style="padding:0 14px 12px;font-size:13px;line-height:1.7" class="ink2">' +
        '沪深 300：沪深两市市值大、流动性好的 300 只股票，代表大盘蓝筹。<br>中证 500：排除沪深 300 后的 500 只中盘股。<br>中证 800 = 沪深 300 + 中证 500。<br>中证 1000：再往下 1000 只小盘股。<br>创业板指、科创 50 分别代表创业板和科创板的龙头。' +
        '<div style="margin-top:6px"><button class="btn sm ghost" onclick="go(\'lesson\',{id:\'boards\'})">看「各板块差异」规则课</button></div></div></div>';
      return h;
    }
    const pool = STOCKS.filter(c => SEC[c].board === mktSeg);
    const sns = pool.map(c => snap(c, S.t));
    const rank = (title, arr) => '<div class="rank-h">' + title + '<small class="muted" style="font-weight:400">原型股票池 ' + pool.length + ' 只</small></div>' + arr.map(sn => quoteRow(sn.code)).join('');
    h += rank('涨幅榜', sns.slice().sort((a, b) => b.pct - a.pct).slice(0, 5));
    h += rank('跌幅榜', sns.slice().sort((a, b) => a.pct - b.pct).slice(0, 5));
    h += '<div class="rank-h">成交额榜</div>' + sns.slice().sort((a, b) => b.amount - a.amount).slice(0, 5).map(sn => '<div class="qrow" onclick="go(\'stock\',{code:\'' + sn.code + '\'})"><div class="nm"><b>' + SEC[sn.code].name + '</b><small>' + SEC[sn.code].sym + tags(sn.code) + '</small></div><div class="px n">' + fx(sn.amount / 1e8, 2) + '<small class="muted">亿</small></div><div class="pc n ' + cls(sn.chg) + '">' + pctS(sn.pct) + '</div></div>').join('');
    return h;
  },
  tick() { const v = $('#view'); const st = v.scrollTop; v.innerHTML = this.render(); v.scrollTop = st; }
};

// ---------- 搜索 ----------
SCREENS.search = {
  title: '搜索', fab: false,
  render(p) {
    return '<div style="padding:10px;background:#fff"><div class="fld" style="padding:0 10px"><input id="sq" placeholder="代码 / 名称 / 拼音首字母，例如 600519、茅台、gzmt" style="text-align:left;font-size:14px;font-family:var(--zh)" oninput="SCREENS.search.list()" autocomplete="off"></div></div><div id="sres"></div>';
  },
  after(p) { $('#sq').focus(); this.list(); },
  list() {
    const p = cur().p, q = ($('#sq').value || '').trim().toLowerCase();
    const res = Object.keys(SEC).filter(c => !q || SEC[c].sym.includes(q) || SEC[c].name.toLowerCase().includes(q) || SEC[c].fullName.includes(q) || SEC[c].py.includes(q));
    $('#sres').innerHTML = (q ? '' : '<div class="sec-h"><small>原型股票池（真实 App 搜索全市场）</small></div>') + res.map(c => {
      const inW = S.watch.includes(c);
      const pick = p.pick ? "pickStock('" + c + "')" : "go('stock',{code:'" + c + "'})";
      return '<div class="row tap" onclick="' + pick + '"><div class="grow"><b style="font-weight:500">' + SEC[c].name + '</b> <span class="muted n" style="font-size:12px">' + SEC[c].sym + '</span>' + tags(c) + '<div class="muted" style="font-size:11px">' + BOARD_NAME[SEC[c].board] + ' · ' + SEC[c].ex + '</div></div>' +
        (SEC[c].board === 'index' || p.pick ? '' : '<button class="btn sm ' + (inW ? 'ghost' : '') + '" onclick="event.stopPropagation();toggleWatch(\'' + c + '\');SCREENS.search.list()">' + (inW ? '已自选' : '＋自选') + '</button>') + '</div>';
    }).join('') || '<div class="empty">没有找到。原型只包含 30 只股票和 8 个指数。</div>';
  }
};
function toggleWatch(c) { const i = S.watch.indexOf(c); if (i >= 0) S.watch.splice(i, 1); else S.watch.push(c); logAct('setting', (i >= 0 ? '移出自选 ' : '加入自选 ') + SEC[c].name); }
function pickStock(c) { R.stack.pop(); const top = cur(); top.p.code = c; OF.price = null; OF.qty = ''; render(true); }

// ---------- 个股详情 ----------
let chartTab = 'min', bookTab = 'book';
function ruleCard(code) {
  const s = SEC[code], m = MK[code], sn = snap(code, S.t), ph = phaseAt(S.t), P = PHASES[ph];
  if (s.board === 'index') return '';
  const a = availableQty(code);
  const cb = cageRange(code, 'B', sn), cs = cageRange(code, 'S', sn);
  const it = (k, v, ok) => '<div class="it"><span class="k">' + k + '</span><span class="v">' + (ok === true ? '<span class="ok">✓ </span>' : ok === false ? '<span class="no">✕ </span>' : '') + v + '</span></div>';
  let h = '<div class="rulecard"><div class="h">这只' + (s.board === 'etf' ? '基金' : '股票') + '的交易规则<button class="btn sm ghost" onclick="go(\'lesson\',{id:\'boards\'})">规则课</button></div>';
  h += it('板块', BOARD_NAME[s.board] + (s.st ? '·风险警示' : '') + '，涨跌幅 ±' + (s.limitPct * 100) + '%' + (s.st ? '（2026-07-06 起主板 ST 由 ±5% 调为 ±10%）' : ''));
  h += it('今日价格区间', '跌停 <b class="n down">' + px(code, m.down) + '</b> ～ 涨停 <b class="n up">' + px(code, m.up) + '</b>');
  h += it('申报单位', s.board === 'kcb' ? '买入 ≥200 股，超出部分 1 股递增' : '100 ' + unitName(code) + '（1 手）整数倍，零股一次性卖出');
  h += it('最小价位', s.tick + ' 元');
  if (ph === 'cont') h += it('价格笼子', cb ? '现在买入价 ≤ <b class="n">' + px(code, cb.max) + '</b>，卖出价 ≥ <b class="n">' + px(code, cs.min) + '</b>' : 'ETF 是否适用待核实（原型不校验）');
  else h += it('价格笼子', '只在连续竞价阶段生效');
  h += it('现在', P.name + '：' + (P.canOrder === 'store' ? '可下单（券商暂存）' : P.canOrder === 'next' ? '下单算下一交易日' : '可下单') + '，' + (P.canCancel ? '可撤单' : '不能撤单'), P.canCancel);
  if (a.held) h += it('我的持仓', intf(a.held) + unitName(code) + '，可卖 ' + intf(a.sellable) + (a.todayBuy ? '（今日买入 ' + intf(a.todayBuy) + ' 受 T+1 限制）' : ''), a.sellable > 0);
  const lots = S.lots.filter(l => l.code === code && l.div > 0);
  if (lots.length) { const tr = divTaxRate(lots[0].date, today()); h += it('红利税', '持有期间收到过分红，现在卖出：' + tr.label + '，约补税 ' + money(lots.reduce((x, l) => x + l.div * l.qty * tr.rate, 0)) + ' 元'); }
  h += it('交易费用', s.board === 'etf' ? '佣金（ETF 免印花税、过户费）' : '佣金 + 过户费 0.001%（双向）+ 印花税 0.05%（仅卖出）');
  return h + '</div>';
}
const PROFILE = {
  sh600519: '贵州茅台酒股份有限公司，主营茅台酒及系列酒的生产与销售，总部位于贵州省仁怀市茅台镇。白酒行业龙头，沪深 300 权重股之一。',
  sz300750: '宁德时代新能源科技股份有限公司，主营动力电池和储能电池系统，总部位于福建宁德。全球动力电池装机量领先企业之一。',
  sh600036: '招商银行股份有限公司，总部位于深圳的全国性股份制商业银行，零售银行和财富管理业务较为突出。',
  sz000858: '宜宾五粮液股份有限公司，主营五粮液系列白酒，总部位于四川宜宾，浓香型白酒代表企业。',
  sh688981: '中芯国际集成电路制造有限公司，中国内地规模领先的晶圆代工企业，在上交所科创板和港交所两地上市。',
  sz000001: '平安银行股份有限公司，中国平安集团旗下的全国性股份制商业银行，总部位于深圳。',
  sh510300: '华泰柏瑞沪深 300 ETF，跟踪沪深 300 指数的交易型开放式指数基金，是 A 股规模最大的宽基 ETF 之一。',
  sz159915: '易方达创业板 ETF，跟踪创业板指数。',
  sz300033: '浙江核新同花顺网络信息股份有限公司，提供证券行情交易软件、金融资讯和数据服务。',
  sz300059: '东方财富信息股份有限公司，运营东方财富网、股吧，并持有东方财富证券等金融牌照。',
  sz002024: '苏宁易购集团股份有限公司，零售企业。股票简称带 ST，表示被实施其他风险警示。'
};
SCREENS.stock = {
  title: p => SEC[p.code].name + '<span class="sub n">' + SEC[p.code].sym + ' · ' + BOARD_NAME[SEC[p.code].board] + '</span>',
  actbar: true,
  navRight: p => '<button class="ib" onclick="toggleWatch(\'' + p.code + '\');refresh()" aria-label="自选">' + (S.watch.includes(p.code) ? '★' : '☆') + '</button>',
  render(p) {
    const code = p.code, s = SEC[code], q = DATA.quotes[code];
    let h = '<div class="qtop" id="qtop">' + this.top(code) + '</div>';
    h += '<div class="ctabs">' + [['min', '分时'], ['day', '日K'], ['week', '周K'], ['month', '月K']].map(([k, l]) => '<button class="' + (chartTab === k ? 'on' : '') + '" onclick="chartTab=\'' + k + '\';refresh()">' + l + '</button>').join('') + '</div>';
    h += '<canvas class="chart" id="cv"></canvas>';
    if (s.board !== 'index') {
      h += '<div class="seg"><button class="' + (bookTab === 'book' ? 'on' : '') + '" onclick="bookTab=\'book\';refresh()">五档盘口</button><button class="' + (bookTab === 'ticks' ? 'on' : '') + '" onclick="bookTab=\'ticks\';refresh()">成交明细</button></div>';
      h += '<div id="bookbox" style="background:#fff;padding:6px 0">' + (bookTab === 'book' ? bookHTML(code, true) : ticksHTML(code)) + '</div>';
      h += ruleCard(code);
      h += '<div class="sec" style="margin-top:8px"><div class="sec-h">公司简况 <small>F10</small></div><div style="padding:0 14px 12px;font-size:13px;line-height:1.7" class="ink2">' + esc(PROFILE[code] || '原型没有这家公司的资料。真实 App 会从东方财富 F10 接口读取公司简介、主营构成、股东和财务数据。') +
        '<div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm ghost" onclick="openAI(\'company\')">让 AI 介绍这家公司</button><button class="btn sm ghost" onclick="openAI(\'trend\')">AI 分析走势</button></div></div></div>';
    } else h += '<div class="note" style="margin:10px">指数不能直接买卖。想买指数，可以买跟踪它的 ETF，例如沪深 300 → 510300。</div>';
    h += '<div style="height:12px"></div>';
    return h;
  },
  top(code) {
    const sn = snap(code, S.t), s = SEC[code], q = DATA.quotes[code], k = cls(sn.chg), d = s.dec;
    const amt = sn.amount;
    const cell = (a, b, c) => '<div><span>' + a + '</span><span class="n ' + (c || '') + '">' + b + '</span></div>';
    let h = '<div class="big"><span class="p n ' + k + '">' + fx(sn.price, s.board === 'index' ? 2 : d) + '</span><span class="c n ' + k + '">' + sgn(sn.chg, s.board === 'index' ? 2 : d) + '　' + pctS(sn.pct) + '</span></div>';
    h += '<div class="ph">' + PHASES[sn.phase].name + ' ' + hms(S.t) + (sn.indicative ? ' · 竞价匹配价 <b class="n">' + px(code, sn.indicative) + '</b>' : '') + '</div>';
    const scale = sn.price / q.price;
    h += '<div class="kv" style="padding-left:0;padding-right:0">' +
      cell('今开', sn.open == null ? '--' : fx(sn.open, d), cls((sn.open || sn.prev) - sn.prev)) + cell('最高', sn.high == null ? '--' : fx(sn.high, d), cls((sn.high || sn.prev) - sn.prev)) + cell('最低', sn.low == null ? '--' : fx(sn.low, d), cls((sn.low || sn.prev) - sn.prev)) +
      cell('昨收', fx(sn.prev, d)) + cell('成交量', (sn.vol / 1e4).toFixed(2) + '万手') + cell('成交额', (amt / 1e8).toFixed(2) + '亿');
    if (s.board !== 'index') h += cell('涨停', fx(sn.up, d), 'up') + cell('跌停', fx(sn.down, d), 'down') + cell('换手', q.turnover == null ? '--' : fx(q.turnover * sn.vol / (q.vol || 1), 2) + '%') +
      (s.board !== 'etf' ? cell('市盈(动)', fx(q.pe * scale, 2)) + cell('市净', fx(q.pb * scale, 2)) + cell('总市值', fx(q.totalCap * scale, 0) + '亿') : cell('52周高', fx(q.w52h, d)) + cell('52周低', fx(q.w52l, d)) + cell('流通值', fx(q.floatCap * scale, 0) + '亿'));
    return h + '</div>';
  },
  after(p) { this.draw(p); },
  draw(p) { const cv = $('#cv'); if (!cv) return; chartTab === 'min' ? drawMinute(cv, p.code) : drawKline(cv, p.code, chartTab); },
  tick(p) {
    $('#qtop').innerHTML = this.top(p.code);
    if (chartTab === 'min') this.draw(p);
    const bb = $('#bookbox'); if (bb) bb.innerHTML = bookTab === 'book' ? bookHTML(p.code, true) : ticksHTML(p.code);
  }
};
// 底部操作栏（个股页）
const _stockRender = SCREENS.stock.render;
SCREENS.stock.render = function (p) {
  setTimeout(() => {
    const old = $('#actbar'); if (old) old.remove();
    if (cur().name !== 'stock' || SEC[p.code].board === 'index') return;
    $('#tabbar').insertAdjacentHTML('beforebegin', '<div class="actbar" id="actbar"><button class="ic" onclick="openAI(\'company\')"><b>✦</b>问 AI</button><button class="ic" onclick="go(\'lesson\',{id:\'boards\'})"><b>§</b>规则</button><button class="btn sell" onclick="go(\'order\',{side:\'S\',code:\'' + p.code + '\'})">卖出</button><button class="btn buy" onclick="go(\'order\',{side:\'B\',code:\'' + p.code + '\'})">买入</button></div>');
  });
  return _stockRender.call(this, p);
};
function bookHTML(code, clickable, onPick) {
  const sn = snap(code, S.t), s = SEC[code];
  const rows = [];
  const pick = p => clickable ? ' onclick="' + (onPick || 'bookPick') + '(' + p + ')"' : '';
  for (let i = 4; i >= 0; i--) { const l = sn.asks[i]; rows.push('<div class="r"' + (l ? pick(l[0]) : '') + '><span>卖' + '一二三四五'[i] + '</span><span class="n ' + (l ? cls(l[0] - sn.prev) : '') + '">' + (l ? fx(l[0], s.dec) : '--') + '</span><span class="n">' + (l ? intf(l[1]) : '') + '</span></div>'); }
  rows.push('<div class="mid"><span>' + (sn.indicative ? '匹配价 ' : '最新 ') + '<b class="n ' + cls(sn.chg) + '">' + px(code, sn.indicative || sn.price) + '</b></span><span class="n">' + (sn.up != null ? '涨停 ' + px(code, sn.up) : '') + '</span></div>');
  for (let i = 0; i < 5; i++) { const l = sn.bids[i]; rows.push('<div class="r"' + (l ? pick(l[0]) : '') + '><span>买' + '一二三四五'[i] + '</span><span class="n ' + (l ? cls(l[0] - sn.prev) : '') + '">' + (l ? fx(l[0], s.dec) : '--') + '</span><span class="n">' + (l ? intf(l[1]) : '') + '</span></div>'); }
  return '<div class="book">' + rows.join('') + '</div>';
}
function bookPick(p) { go('order', { side: 'B', code: cur().p.code, price: p }); }
function ticksHTML(code) {
  const s = SEC[code]; if (S.t < T(9, 30)) return '<div class="empty">9:30 以后显示逐笔成交</div>';
  const out = []; let t = Math.floor(S.t / 3) * 3;
  for (let i = 0; i < 11 && t > T(9, 30); i++, t -= 3) {
    if (phaseAt(t) !== 'cont') { t = t > T(13, 0) ? T(11, 30) + 3 : t; continue; }
    const p1 = priceAt(code, t), p0 = priceAt(code, t - 3), v = Math.max(1, Math.round(volAt(code, t) - volAt(code, t - 3)));
    out.push('<div class="r" style="cursor:default"><span class="n" style="width:62px;color:var(--ink3)">' + hms(t) + '</span><span class="n ' + cls(p1 - MK[code].prev) + '">' + fx(p1, s.dec) + '</span><span class="n ' + (p1 >= p0 ? 'up' : 'down') + '">' + intf(v) + (p1 >= p0 ? ' B' : ' S') + '</span></div>');
  }
  return '<div class="book">' + out.join('') + '<div class="muted" style="font-size:11px;padding:4px 10px">原型按 3 秒快照推算；腾讯接口免费版只有快照，没有逐笔。</div></div>';
}
