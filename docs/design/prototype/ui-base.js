/* AShareSim 原型 · UI 基础：路由、浮层、图表、时钟 */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = v => v > 1e-9 ? 'up' : v < -1e-9 ? 'down' : 'flat';
const sgn = (v, d = 2) => (v > 0 ? '+' : '') + fx(v, d);
const pctS = v => sgn(v, 2) + '%';
const px = (code, v) => fx(v, SEC[code].dec);
const unitName = code => SEC[code].board === 'etf' ? '份' : '股';
function tags(code) {
  const s = SEC[code]; let h = '';
  if (s.st) h += '<span class="tag st">ST</span>';
  if (s.board === 'cyb') h += '<span class="tag cyb">创</span>';
  if (s.board === 'kcb') h += '<span class="tag kcb">科</span>';
  if (s.board === 'etf') h += '<span class="tag etf">ETF</span>';
  return h;
}
const symOf = code => SEC[code].sym;
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const dateLabel = d => { const x = new Date(d + 'T00:00:00'); return d.slice(5).replace('-', '/') + ' 周' + WD[x.getDay()]; };

// ---------- 路由 ----------
const R = { stack: [{ name: 'watch', p: {} }] };
const SCREENS = {};
const TABS = [
  ['watch', '自选', '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z"/>'],
  ['market', '行情', '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'],
  ['trade', '交易', '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>'],
  ['learn', '学习', '<path d="M3 6.5L12 3l9 3.5-9 3.5z"/><path d="M7 8.5v5c0 1.7 2.2 3 5 3s5-1.3 5-3v-5M21 6.5v6"/>'],
  ['me', '我的', '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>']
];
function cur() { return R.stack[R.stack.length - 1]; }
function go(name, p) { R.stack.push({ name, p: p || {} }); render(true); }
function back() { if (R.stack.length > 1) { R.stack.pop(); render(true); } }
function tab(name) { R.stack = [{ name, p: {} }]; render(true); }
function replace(name, p) { R.stack[R.stack.length - 1] = { name, p: p || {} }; render(true); }
let lastRender = 0;
function render(resetScroll) {
  const c = cur(), sc = SCREENS[c.name];
  const view = $('#view');
  const st = view.scrollTop;
  const ab = $('#actbar'); if (ab) ab.remove();
  const title = typeof sc.title === 'function' ? sc.title(c.p) : sc.title;
  const root = !!sc.root;
  $('#nav').className = 'nav' + (root ? ' root' : '');
  $('#nav').innerHTML = (root ? '' : '<button class="ib" onclick="back()" aria-label="返回">‹</button>') +
    '<h1>' + title + '</h1>' + (sc.navRight ? sc.navRight(c.p) : (root ? '' : '<span style="width:40px"></span>'));
  view.innerHTML = sc.render(c.p);
  $('#tabbar').style.display = root ? '' : 'none';
  const rootName = R.stack[0].name;
  $('#tabbar').innerHTML = TABS.map(([k, l, ic]) => '<button class="' + (k === rootName ? 'on' + (k === 'learn' ? ' lt' : '') : '') + '" onclick="tab(\'' + k + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">' + ic + '</svg>' + l + '</button>').join('');
  const fab = sc.fab === false ? '' : '<button class="fab" onclick="openAI()" aria-label="问 AI">AI</button>';
  const old = $('#app .fab'); if (old) old.remove();
  if (fab && c.name !== 'ai') $('#app').insertAdjacentHTML('beforeend', fab);
  if (root) { const f = $('#app .fab'); if (f) f.style.bottom = '72px'; } else { const f = $('#app .fab'); if (f) f.style.bottom = sc.actbar ? '76px' : '18px'; }
  view.scrollTop = resetScroll ? 0 : st;
  if (sc.after) sc.after(c.p);
  renderConsolePages();
}
function refresh() { render(false); }

// ---------- 浮层 ----------
function closeOverlay() { $('#overlay').innerHTML = ''; }
function modal(o) {
  // o: {title, body, ok, okCls, cancel, onOk, onCancel, extra:[{label, fn}]}
  window.__m = o;
  const btns = [];
  if (o.cancel !== false) btns.push('<button onclick="closeOverlay();__m.onCancel&&__m.onCancel()">' + (o.cancel || '取消') + '</button>');
  (o.extra || []).forEach((e, i) => btns.push('<button onclick="closeOverlay();__m.extra[' + i + '].fn()">' + e.label + '</button>'));
  btns.push('<button class="pri ' + (o.okCls || '') + '" onclick="closeOverlay();__m.onOk&&__m.onOk()">' + (o.ok || '确定') + '</button>');
  $('#overlay').innerHTML = '<div class="mask" onclick="if(event.target===this)closeOverlay()"><div class="dlg" role="dialog"><div class="dh">' + o.title + '</div><div class="db">' + o.body + '</div><div class="df">' + btns.join('') + '</div></div></div>';
}
function sheet(title, html) {
  $('#overlay').innerHTML = '<div class="mask bottom" onclick="if(event.target===this)closeOverlay()"><div class="sheet"><div class="sh">' + title + '</div>' + html + '</div></div>';
}
function showToast(msg, kind, ref) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  if (kind === 'fill' && ref) el.onclick = () => go('fillDetail', { id: ref });
  if (kind === 'learn') el.onclick = () => go('stage', { no: 0 });
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'info' || kind === 'learn' ? 4200 : 2800);
}
function ruleError(v) {
  modal({
    title: v.level === 'warn' ? '提交后会成为废单' : '无法下单', cancel: v.lesson ? '看规则' : false, ok: v.level === 'warn' ? '修改价格' : '知道了',
    body: '<div style="font-weight:600;margin-bottom:6px">' + esc(v.rule) + '</div><div class="ink2" style="font-size:13px">' + esc(v.msg) + '</div>',
    onCancel: v.lesson ? () => go('lesson', { id: v.lesson }) : null
  });
}

// ---------- 图表 ----------
function setupCanvas(cv, h) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 390;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h); ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--num');
  return { ctx, w, h };
}
const C_UP = '#E5322D', C_DN = '#0E9F5B', C_GRID = '#EEF0F2', C_TXT = '#9AA0A8';
function drawMinute(cv, code) {
  const { ctx, w, h } = setupCanvas(cv, 230);
  const m = MK[code], s = SEC[code];
  const xNow = S.t < T(9, 30) ? -1 : minuteX(S.t);
  const ph = h * 0.72, vh = h * 0.17, vTop = ph + h * 0.04, padL = 4, padR = 4;
  const n = Math.floor(xNow);
  const pts = []; for (let i = 0; i <= n && i <= 240; i++) pts.push(m.path[i]);
  if (xNow >= 0 && xNow < 240) pts.push(priceAt(code, S.t));
  let dev = Math.max(...pts.map(v => Math.abs(v - m.prev)), m.prev * 0.004);
  const top = m.prev + dev * 1.08, bot = m.prev - dev * 1.08;
  const X = i => padL + (w - padL - padR) * i / 240, Y = v => 6 + (ph - 12) * (top - v) / (top - bot);
  ctx.strokeStyle = C_GRID; ctx.lineWidth = 1;
  for (const gx of [0, 60, 120, 180, 240]) { ctx.beginPath(); ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), ph); ctx.stroke(); }
  ctx.setLineDash([3, 3]); ctx.strokeStyle = '#C9CDD2'; ctx.beginPath(); ctx.moveTo(0, Y(m.prev)); ctx.lineTo(w, Y(m.prev)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C_UP; ctx.fillText(fx(top, s.dec), 4, 14); ctx.fillStyle = C_DN; ctx.fillText(fx(bot, s.dec), 4, ph - 4);
  ctx.textAlign = 'right'; ctx.fillStyle = C_UP; ctx.fillText(pctS((top / m.prev - 1) * 100), w - 4, 14); ctx.fillStyle = C_DN; ctx.fillText(pctS((bot / m.prev - 1) * 100), w - 4, ph - 4); ctx.textAlign = 'left';
  ctx.fillStyle = C_TXT; ctx.fillText('09:30', 4, h - 1); ctx.textAlign = 'center'; ctx.fillText('11:30/13:00', X(120), h - 1); ctx.textAlign = 'right'; ctx.fillText('15:00', w - 4, h - 1); ctx.textAlign = 'left';
  if (!pts.length) { ctx.fillStyle = C_TXT; ctx.textAlign = 'center'; ctx.fillText(S.t < T(9, 15) ? '未开盘' : '集合竞价中，9:30 开始连续竞价', w / 2, ph / 2); ctx.textAlign = 'left'; return; }
  // 均价线
  let sa = 0, sv = 0; const avg = [];
  for (let i = 0; i < pts.length; i++) { const dv = i ? Math.max(0, m.cum[Math.min(i, 240)] - m.cum[i - 1]) : m.cum[0]; sa += pts[i] * dv; sv += dv; avg.push(sv ? sa / sv : pts[i]); }
  ctx.lineWidth = 1.3; ctx.strokeStyle = '#2B6DE5'; ctx.beginPath();
  pts.forEach((v, i) => { const xx = i === pts.length - 1 && xNow < 240 ? X(xNow) : X(i); i ? ctx.lineTo(xx, Y(v)) : ctx.moveTo(xx, Y(v)); }); ctx.stroke();
  const g = ctx.createLinearGradient(0, 0, 0, ph); g.addColorStop(0, 'rgba(43,109,229,.16)'); g.addColorStop(1, 'rgba(43,109,229,0)');
  ctx.lineTo(X(Math.min(xNow, 240)), ph); ctx.lineTo(X(0), ph); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#F0A030'; ctx.lineWidth = 1; ctx.beginPath(); avg.forEach((v, i) => { const xx = i === avg.length - 1 && xNow < 240 ? X(xNow) : X(i); i ? ctx.lineTo(xx, Y(v)) : ctx.moveTo(xx, Y(v)); }); ctx.stroke();
  // 成交量
  let vmax = 1; const vs = []; for (let i = 0; i < pts.length && i <= 240; i++) { const dv = i ? Math.max(0, m.cum[i] - m.cum[i - 1]) : m.cum[0] * 0.3; vs.push(dv); vmax = Math.max(vmax, dv); }
  const bw = Math.max(0.6, (w - padL - padR) / 241 - 0.3);
  vs.forEach((v, i) => { ctx.fillStyle = i && pts[i] < pts[i - 1] ? C_DN : C_UP; const hh = vh * v / vmax; ctx.fillRect(X(i) - bw / 2, vTop + vh - hh, bw, hh); });
}
function aggBars(bars, period) {
  if (period === 'day') return bars;
  const out = []; let curK = null, b = null;
  for (const r of bars) {
    const d = new Date(r[0] + 'T00:00:00');
    let k;
    if (period === 'week') { const dd = new Date(d); dd.setDate(d.getDate() - ((d.getDay() + 6) % 7)); k = dd.toISOString().slice(0, 10); }
    else k = r[0].slice(0, 7);
    if (k !== curK) { if (b) out.push(b); curK = k; b = [r[0], r[1], r[2], r[3], r[4], r[5]]; }
    else { b[0] = r[0]; b[2] = r[2]; b[3] = Math.max(b[3], r[3]); b[4] = Math.min(b[4], r[4]); b[5] += r[5]; }
  }
  if (b) out.push(b); return out;
}
function liveBars(code) {
  const bars = (DATA.kline[code] || []).slice();
  const sn = snap(code, S.t);
  if (sn.last != null && bars.length && bars[bars.length - 1][0] !== today()) bars.push([today(), sn.open, sn.price, sn.high, sn.low, sn.vol]);
  else if (sn.last != null && bars.length && bars[bars.length - 1][0] === today()) bars[bars.length - 1] = [today(), sn.open, sn.price, sn.high, sn.low, sn.vol];
  return bars;
}
function drawKline(cv, code, period) {
  const { ctx, w, h } = setupCanvas(cv, 230);
  const s = SEC[code];
  const all = aggBars(liveBars(code), period);
  const N = 60, bars = all.slice(-N), off = all.length - bars.length;
  const ma = n => all.map((r, i) => i >= n - 1 ? all.slice(i - n + 1, i + 1).reduce((a, x) => a + x[2], 0) / n : null).slice(off);
  const m5 = ma(5), m10 = ma(10), m20 = ma(20);
  const ph = h * 0.7, vTop = ph + 18, vh = h - vTop - 12;
  let hi = -Infinity, lo = Infinity; bars.forEach(r => { hi = Math.max(hi, r[3]); lo = Math.min(lo, r[4]); });
  const pad = (hi - lo) * 0.06; hi += pad; lo -= pad;
  const cw = (w - 8) / N, X = i => 4 + cw * i + cw / 2, Y = v => 14 + (ph - 18) * (hi - v) / (hi - lo);
  ctx.strokeStyle = C_GRID; for (let k = 0; k <= 3; k++) { const yy = 14 + (ph - 18) * k / 3; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke(); }
  const last = bars[bars.length - 1];
  ctx.fillStyle = '#F0A030'; ctx.fillText('MA5 ' + fx(m5[m5.length - 1], s.dec), 4, 10); ctx.fillStyle = '#8A4FD8'; ctx.fillText('MA10 ' + fx(m10[m10.length - 1], s.dec), 84, 10); ctx.fillStyle = '#2B6DE5'; ctx.fillText('MA20 ' + fx(m20[m20.length - 1], s.dec), 172, 10);
  let vmax = 1; bars.forEach(r => vmax = Math.max(vmax, r[5]));
  bars.forEach((r, i) => {
    const upb = r[2] >= r[1], col = upb ? C_UP : C_DN;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(i), Y(r[3])); ctx.lineTo(X(i), Y(Math.max(r[1], r[2]))); ctx.moveTo(X(i), Y(Math.min(r[1], r[2]))); ctx.lineTo(X(i), Y(r[4])); ctx.stroke();
    const y1 = Y(Math.max(r[1], r[2])), y2 = Y(Math.min(r[1], r[2])), bw = Math.max(1, cw * 0.7);
    if (upb) { ctx.fillStyle = '#fff'; ctx.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1)); ctx.strokeRect(X(i) - bw / 2 + .5, y1 + .5, bw - 1, Math.max(1, y2 - y1) - 1); }
    else ctx.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1));
    const vv = vh * r[5] / vmax; ctx.fillStyle = col; ctx.globalAlpha = upb ? 0.55 : 0.8; ctx.fillRect(X(i) - bw / 2, vTop + vh - vv, bw, vv); ctx.globalAlpha = 1;
  });
  const line = (arr, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); let st = false; arr.forEach((v, i) => { if (v == null) return; st ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); st = true; }); ctx.stroke(); };
  line(m5, '#F0A030'); line(m10, '#8A4FD8'); line(m20, '#2B6DE5');
  ctx.fillStyle = C_TXT; ctx.fillText(fx(hi, s.dec), w - 50, 24); ctx.fillText(fx(lo, s.dec), w - 50, ph - 2);
  ctx.fillText(bars[0][0], 4, h - 1); ctx.textAlign = 'right'; ctx.fillText(last[0], w - 4, h - 1); ctx.textAlign = 'left';
  ctx.fillText('成交量', 4, vTop - 4);
}
function drawLines(cv, series, opt) {
  // series: [{name, color, data:[number]}], labels: [date]
  const { ctx, w, h } = setupCanvas(cv, opt.h || 180);
  let hi = -Infinity, lo = Infinity; series.forEach(s => s.data.forEach(v => { if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }));
  const pad = (hi - lo) * 0.08 || 1; hi += pad; lo -= pad;
  const n = series[0].data.length, X = i => 6 + (w - 12) * i / Math.max(1, n - 1), Y = v => 18 + (h - 36) * (hi - v) / (hi - lo);
  ctx.strokeStyle = C_GRID; for (let k = 0; k <= 3; k++) { const yy = 18 + (h - 36) * k / 3; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke(); }
  if (opt.zero != null) { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#C9CDD2'; ctx.beginPath(); ctx.moveTo(0, Y(opt.zero)); ctx.lineTo(w, Y(opt.zero)); ctx.stroke(); ctx.setLineDash([]); }
  let lx = 6;
  series.forEach(s => {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5; ctx.beginPath(); let st = false;
    s.data.forEach((v, i) => { if (v == null) return; st ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); st = true; }); ctx.stroke();
    ctx.fillStyle = s.color; ctx.fillRect(lx, 5, 10, 3); ctx.fillStyle = '#5C626B'; ctx.fillText(s.name, lx + 14, 10); lx += ctx.measureText(s.name).width + 30;
  });
  ctx.fillStyle = C_TXT; ctx.fillText(opt.fmt ? opt.fmt(hi) : fx(hi, 2), w - 54, 28); ctx.fillText(opt.fmt ? opt.fmt(lo) : fx(lo, 2), w - 54, h - 22);
  if (opt.labels) { ctx.fillText(opt.labels[0], 6, h - 4); ctx.textAlign = 'right'; ctx.fillText(opt.labels[opt.labels.length - 1], w - 6, h - 4); ctx.textAlign = 'left'; }
}
function ringSVG(done, total, color) {
  const p = total ? done / total : 0, r = 15, c = 2 * Math.PI * r;
  return '<svg class="ring" viewBox="0 0 38 38"><circle cx="19" cy="19" r="' + r + '" fill="none" stroke="#E6E9EC" stroke-width="4"/>' + (p > 0 ? '<circle cx="19" cy="19" r="' + r + '" fill="none" stroke="' + (color || '#0F7B76') + '" stroke-width="4" stroke-dasharray="' + (c * p) + ' ' + c + '" transform="rotate(-90 19 19)" stroke-linecap="round"/>' : '') + '<text x="19" y="22.5" text-anchor="middle" font-size="10" fill="#5C626B" font-family="Arial">' + done + '/' + total + '</text></svg>';
}

// ---------- 时钟 ----------
let realLast = performance.now(), tickAcc = 0;
function phaseLabel() { const ph = phaseAt(S.t); return PHASES[ph]; }
function loop(now) {
  const dt = Math.min(1, (now - realLast) / 1000); realLast = now;
  if (S.running && S.t < T(23, 59, 50)) {
    const t1 = Math.min(T(23, 59, 50), S.t + dt * S.speed);
    advanceTo(t1);
  }
  tickAcc += dt;
  while (S.toastQ.length) { const q = S.toastQ.shift(); showToast(q.msg, q.kind, q.ref); dirty = true; }
  if (tickAcc > 0.5) {
    tickAcc = 0;
    $('#sbTime').textContent = hms(S.t).slice(0, 5);
    $('#sbPhase').textContent = phaseLabel().short;
    renderClock();
    const c = cur(), sc = SCREENS[c.name];
    if (dirty && sc.liveRefresh && !$('#overlay').innerHTML) { dirty = false; refresh(); }
    else if (sc.tick) sc.tick(c.p);
    dirty = false;
  }
}
let dirty = false;
