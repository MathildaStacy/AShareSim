/* AShareSim 原型 · 学习：路线图、规则课、工具（阶段 0/1/2/3/7） */
'use strict';
const STAGES = [
  { no: 0, title: '了解 A 股交易规则', short: '规则', dur: '1 到 2 周', goal: '了解你将来要交易的市场有哪些规则。',
    learn: ['基本交易规则：T+1、主板涨跌停 ±10%、最少买 100 股。', '交易时间：集合竞价 9:15 到 9:25（9:20 以后不能撤单）、连续竞价、收盘集合竞价。', '交易成本：印花税、过户费、佣金和「免五」、红利税的阶梯税率。', '指数体系：沪深300、中证500、中证800、中证1000 分别代表哪些股票，和主板、创业板、科创板是什么关系。'],
    ex: [['s0-e0', '在「费率设置」里填入你真实券商的佣金，并用一条真实交割单校准', 'auto'], ['s0-e1', '用集合竞价买一手宽基 ETF，走一遍预埋单、按开盘价成交、查看交割单', 'auto']],
    pass: [['s0-p0', '能说清一笔股票买卖要交哪些费用（完成「交易费用」小测）', 'auto'], ['s0-p1', '能解释为什么集合竞价的成交价就是开盘价（完成集合竞价演示）', 'auto']],
    tools: [['lessons', '规则课'], ['feeCalc', '费用计算器'], ['auction', '集合竞价演示']] },
  { no: 1, title: 'Python 数据分析工具', short: 'Python', dur: '2 到 4 周', goal: '熟练用 pandas 处理金融时间序列和截面数据。',
    learn: ['pandas 核心操作：索引、groupby、rolling、rank、shift、merge、多重索引。', '向量化写法：用整体运算代替 for 循环。做后端转过来，最需要改的就是这个习惯。', '用 matplotlib 画基本图表。', '工作方式：Jupyter 用来探索，.py 文件和 git 用来沉淀代码。'],
    ex: [['s1-e0', '用 App 导出的沪深300、中证800 日线，算每年收益率、年化波动率、最大回撤、滚动一年收益，并画净值曲线'], ['s1-e1', '把你自己的交割单 CSV 读进 pandas，按月汇总费用']],
    pass: [['s1-p0', '不写 for 循环，10 行左右算出「每只股票过去 20 日收益在当天全市场的排名」']],
    tools: [['datalab', '数据练习与导出']] },
  { no: 2, title: '统计和投资基础', short: '统计', dur: '2 到 4 周', goal: '理解收益、风险和「超额收益」这些概念到底在算什么。',
    learn: ['收益和风险指标：简单收益和对数收益、波动率、夏普比率、最大回撤。', '统计工具：相关性、线性回归、t 检验，以及多重检验问题。', '超额收益的拆解：beta 和 alpha、跟踪误差、信息比率。', '收益从哪里来：风险溢价和市场有效性。'],
    ex: [['s2-e0', '在「账户分析」里把你的模拟账户相对沪深300 拆成 beta 和 alpha，看懂每个数是怎么算的'], ['s2-e1', '找 2 到 3 只沪深300 指数增强基金，下载近 5 年净值，算每年超额、跟踪误差、信息比率、超额最大回撤（在电脑上做）']],
    pass: [['s2-p0', '能把任意组合的收益拆成「基准收益加超额收益」'], ['s2-p1', '能判断这部分超额在统计上是不是显著']],
    tools: [['analysis', '账户分析']] },
  { no: 3, title: '搭建本地数据库', short: '数据库', dur: '2 到 3 周', goal: '一条命令就能把数据更新到最新，并且数据可信。这一阶段你的后端经验最有用。',
    learn: ['数据内容：股票列表（包括已退市的）、日线、复权因子、停复牌、ST、涨跌停价、带公告日期的财务数据、行业、指数成分。', '存储：parquet 文件或 DuckDB（App 里是 SQLite）。', '增量更新：只拉新增的数据。', '数据质量检查：价格缺失或跳变、复权是否连续、退市股票是否完整。'],
    ex: [['s3-e0', '看懂 App「数据中心」的每张表和每项检查，然后在电脑上写 update_data 命令和检查脚本'], ['s3-e1', '用它复现阶段 1 的指数年度收益，和腾讯、新浪接口交叉核对']],
    pass: [['s3-p0', '任意一天都能回答：哪些股票在股票池里、哪些停牌、哪些开盘就是涨跌停价'], ['s3-p1', '任意一天只能看到当时已经公告的财务数据']],
    tools: [['datacenter', '数据中心']] },
  { no: 7, title: '模拟执行', short: '模拟', dur: '3 个月', goal: '验证回测和真实执行流程能不能对得上。本 App 的保守撮合正好用来做这一步。',
    learn: ['周五晚上生成买卖清单。', '周末人工核对停牌、ST 和重大公告。', '周一按集合竞价规则成交（App 自动记录成交依据）。', '未成交的单子按固定规则补单。', '每笔模拟成交都记录下来。'],
    ex: [['s7-e0', '连续 12 周不间断执行', 'auto'], ['s7-e1', '用这 3 个月的真实行情重跑回测，和模拟记录逐周对比']],
    pass: [['s7-p0', '连续 12 周没有漏执行', 'auto'], ['s7-p1', '模拟结果和同期回测重放的偏差能解释清楚，而且比较小']],
    tools: [['exec', '模拟执行']], note: '路线图原文：不用券商模拟盘，它的成交规则太宽松。这里提前做，是因为 App 本身就是一个按真实规则记录「假如成交」的工具。' }
];
const stageItems = st => st.ex.concat(st.pass);
const stageDone = st => stageItems(st).filter(i => S.checks[i[0]]).length;
function curStage() { return STAGES.find(st => stageDone(st) < stageItems(st).length) || STAGES[STAGES.length - 1]; }
function toggleCheck(id) { if (S.checks[id] && S.checks[id].auto) return showToast('这一项由 App 根据你的操作自动判断'); if (S.checks[id]) delete S.checks[id]; else S.checks[id] = { date: today() }; refresh(); }
function autoCheck(id, msg) { if (!S.checks[id]) { S.checks[id] = { auto: true, date: today() }; showToast('学习进度：' + msg, 'learn'); } }
SCREENS.learn = {
  title: '学习', root: true,
  render() {
    const cs = curStage(), all = STAGES.reduce((a, s) => a + stageItems(s).length, 0), done = STAGES.reduce((a, s) => a + stageDone(s), 0);
    let h = '<div class="lhero"><div class="t">量化学习路线 · App 覆盖阶段 0、1、2、3、7</div><div class="s">当前：阶段 ' + cs.no + ' · ' + cs.title + '</div><div class="lbar"><i style="width:' + (done / all * 100) + '%"></i></div><div class="t" style="margin-top:6px">总进度 ' + done + '/' + all + ' · 阶段 4–6 在电脑上做，不进 App</div></div>';
    h += '<div class="tools">' + [['lessons', '规', '规则课'], ['feeCalc', '费', '费用计算器'], ['auction', '竞', '集合竞价'], ['datalab', 'Py', '数据练习'], ['analysis', 'α', '账户分析'], ['datacenter', 'DB', '数据中心'], ['exec', '周', '模拟执行'], ['roadmap', '图', '完整路线']].map(([k, i, l]) => '<button onclick="' + (k === 'roadmap' ? 'roadmapInfo()' : "go('" + k + "')") + '"><i>' + i + '</i>' + l + '</button>').join('') + '</div>';
    h += '<div class="sec" style="margin-top:8px"><div class="sec-h">阶段</div>' + STAGES.map(st => '<div class="stage-card' + (st === cs ? ' cur' : '') + '" onclick="go(\'stage\',{no:' + st.no + '})"><div class="no">' + st.no + '</div><div class="grow" style="flex:1"><div class="tt">' + st.title + '</div><div class="ds">' + st.dur + (st.no === 7 ? ' · 提前做' : '') + '</div></div>' + ringSVG(stageDone(st), stageItems(st).length) + '</div>').join('') + '</div>';
    return h;
  }
};
function roadmapInfo() { modal({ title: '完整路线图', cancel: false, ok: '知道了', body: '<div class="ink2" style="font-size:13px">完整的 10 个阶段在仓库 <span class="mono">docs/research/quant-roadmap.html</span>。App 只覆盖和「了解 A 股」直接相关的阶段 0–3，并提前做阶段 7（模拟执行）。阶段 4 单因子、5 回测、6 机器学习需要在电脑上写代码，App 负责给它们提供数据和成交记录。</div>' }); }
SCREENS.stage = {
  title: p => '阶段 ' + p.no,
  render(p) {
    const st = STAGES.find(x => x.no === p.no);
    const ck = ([id, t, auto]) => '<div class="chk' + (S.checks[id] ? ' on' : '') + '" onclick="toggleCheck(\'' + id + '\')"><span class="bx">' + (S.checks[id] ? '✓' : '') + '</span><span>' + t + (auto ? '<span class="auto">自动</span>' : '') + (S.checks[id] ? '<small class="muted" style="display:block;font-size:11px">' + S.checks[id].date + ' 完成</small>' : '') + '</span></div>';
    return '<div class="sec" style="padding:14px"><div style="font-size:18px;font-weight:600">' + st.title + '</div><div class="muted" style="font-size:12px">' + st.dur + '</div><p style="margin-top:8px">' + st.goal + '</p>' + (st.note ? '<div class="note lt" style="margin-top:8px">' + st.note + '</div>' : '') + '</div>' +
      '<div class="sec"><div class="sec-h">要学的</div><ul style="padding:0 14px 12px 32px;font-size:13px;line-height:1.8" class="ink2">' + st.learn.map(x => '<li>' + x + '</li>').join('') + '</ul></div>' +
      '<div class="sec"><div class="sec-h">练习</div>' + st.ex.map(ck).join('') + '</div>' +
      '<div class="sec"><div class="sec-h">通关标准</div>' + st.pass.map(ck).join('') + '</div>' +
      '<div class="sec" style="padding:12px 14px;display:flex;gap:8px;flex-wrap:wrap">' + st.tools.map(([k, l]) => '<button class="btn lt sm" onclick="go(\'' + k + '\')">' + l + '</button>').join('') + '</div>';
  }
};

// ---------- 规则课 ----------
const LESSONS = [
  { id: 'time', title: '交易时间与集合竞价', body: `<p>A 股每个交易日分成几段，每段能做的事不一样：</p>
<table class="t"><tr><th>时间</th><th style="text-align:left">阶段</th><th>撤单</th></tr><tr><td>9:15–9:20</td><td style="text-align:left">开盘集合竞价</td><td>可以</td></tr><tr><td>9:20–9:25</td><td style="text-align:left">开盘集合竞价</td><td>不可以</td></tr><tr><td>9:25–9:30</td><td style="text-align:left">静默，交易所不收单</td><td>不可以</td></tr><tr><td>9:30–11:30</td><td style="text-align:left">连续竞价</td><td>可以</td></tr><tr><td>13:00–14:57</td><td style="text-align:left">连续竞价</td><td>可以</td></tr><tr><td>14:57–15:00</td><td style="text-align:left">收盘集合竞价</td><td>不可以</td></tr><tr><td>15:05–15:30</td><td style="text-align:left">盘后固定价格交易</td><td>可以</td></tr></table>
<h3>集合竞价怎么定价</h3><p>9:15 到 9:25 的所有买卖单先攒在一起，不成交。9:25 交易所找出一个价格，让<b>能成交的数量最多</b>，所有能成交的单都按这同一个价格成交。这个价格就是开盘价。所以你出价 10.50 买入，开盘价是 10.30，你的成交价是 10.30。</p>
<h3>为什么 9:20 以后不能撤单</h3><p>防止有人先挂大单影响匹配价、再在最后一刻撤掉。</p>
<div class="eg">2026-07-06 起，盘后固定价格交易扩大到全部 A 股和沪深 ETF；沪市基金的收盘阶段也改成了集合竞价。</div>`,
    quiz: [{ q: '9:22 下了一笔买单，现在想撤，可以吗？', o: ['可以，随时能撤', '现在不行，9:30 连续竞价开始后如果还没成交就能撤', '一旦下单永远不能撤'], a: 1, e: '9:20–9:30 交易所不接受撤单。进入连续竞价后，没成交的部分可以撤。' },
      { q: '集合竞价时你出价 10.50 买入，开盘价是 10.30，你的成交价是？', o: ['10.50', '10.30', '两者平均 10.40'], a: 1, e: '集合竞价所有成交都按同一个价格，也就是开盘价。' }], practice: ['auction', '去集合竞价演示'] },
  { id: 't1', title: 'T+1：今天买，明天才能卖', body: `<p>A 股股票实行 T+1：当天买入的股票，下一个交易日才能卖出。周五买的，最早下周一卖。</p><p>资金正好相反：卖出股票得到的钱<b>当天就能再买</b>，但要到下一个交易日才能转到银行卡（「可用」和「可取」的区别）。</p><p>大多数股票型 ETF 也是 T+1。跨境 ETF、债券 ETF、黄金 ETF、货币 ETF 可以 T+0（当天买当天卖）。</p><div class="eg">在交易页的持仓里，今天买的宁德时代「可用」是 0，后面标着 T+1。</div>`,
    quiz: [{ q: '周五 10:00 买入一只主板股票，最早什么时候能卖？', o: ['周五 13:00', '下周一开盘', '下周二'], a: 1, e: 'T+1 指下一个交易日。周末不是交易日，所以是下周一。' }], practice: ['trade', '看持仓的可用数量'] },
  { id: 'limit', title: '涨跌停', body: `<p>每只股票每天的价格只能在前收盘价的一定比例内波动：</p><ul><li>主板：±10%（含 ST、*ST：2026-07-06 起由 ±5% 调整为 ±10%）</li><li>创业板、科创板：±20%</li><li>北交所：±30%（本 App 暂不覆盖）</li><li>新股上市前 5 个交易日不设涨跌幅</li></ul><p>涨停价 = 前收盘价 × (1 + 比例)，四舍五入到分。超出这个范围的委托券商直接拒绝。</p><div class="eg">平安银行前收 11.20，涨停 11.20 × 1.1 = 12.32，跌停 11.20 × 0.9 = 10.08。</div><p>涨停时买单要排队，前面的封单没成交完，你的单就不会成交。App 按这个规则模拟，不会让你「秒买」到涨停股。</p>`,
    quiz: [{ q: '一只主板 ST 股前收 1.10 元，今天的涨停价是？', o: ['1.16', '1.21', '1.32'], a: 1, e: '2026-07-06 起主板 ST 也是 ±10%：1.10 × 1.1 = 1.21。' }], practice: ['stock:sz002024', '看 ST 易购的涨跌停'] },
  { id: 'cage', title: '价格笼子', body: `<p>连续竞价阶段，限价单不能离当前盘口太远：</p><ul><li>买入价 ≤ max(卖一 × 102%，卖一 + 0.10 元)</li><li>卖出价 ≥ min(买一 × 98%，买一 − 0.10 元)</li></ul><p>「+0.10 元」是给 5 元以下低价股留的余地。科创板只有 2% 这一条。没有卖一时用买一，都没有时用最新价。</p><p>超出范围的单子会被交易所拒收，变成<b>废单</b>。集合竞价阶段不受价格笼子限制。</p><div class="eg">卖一 10.00：10 × 1.02 = 10.20 ＞ 10.10，所以最高只能出 10.20。<br>卖一 3.00：3 × 1.02 = 3.06 ＜ 3.10，所以最高能出 3.10。</div><p>示例账户今天有一笔招商银行的卖单因为价格太低成了废单，可以去当日委托里看。</p>`,
    quiz: [{ q: '主板某股卖一 4.00 元，买入委托价最高能填多少？', o: ['4.08', '4.10', '4.40'], a: 1, e: 'max(4.00 × 1.02, 4.00 + 0.10) = max(4.08, 4.10) = 4.10。' }], practice: ['orders', '看废单'] },
  { id: 'unit', title: '申报单位与零股', body: `<p>买入必须是 100 股（1 手）的整数倍。科创板例外：一次至少 200 股，超过 200 股的部分可以 1 股为单位增加，比如 201 股。</p><p>零股（不足 100 股的部分，通常来自送股）只能卖不能买，并且要<b>一次性</b>卖掉。比如持有 250 股，可以卖 100、200、50、150、250 股，但不能卖 120 股。</p><p>股票最小价位是 0.01 元，ETF 是 0.001 元。</p>`,
    quiz: [{ q: '持有某主板股票 250 股，下面哪笔卖出委托不合规？', o: ['200 股', '150 股', '120 股'], a: 2, e: '120 股里含 20 股零股，没有把 50 股零股一次卖完。' }, { q: '科创板一笔最少买多少股？', o: ['100 股', '200 股', '500 股'], a: 1, e: '科创板单笔申报不少于 200 股。' }], practice: ['order:B:sh688981', '试着买 150 股中芯国际'] },
  { id: 'fee', title: '交易费用', body: `<table class="t"><tr><th>费用</th><th>费率</th><th>方向</th></tr><tr><td>印花税</td><td>0.05%</td><td>仅卖出</td></tr><tr><td>过户费</td><td>0.001%</td><td>买卖都收</td></tr><tr><td>经手费</td><td>0.00341%</td><td>买卖都收</td></tr><tr><td>证管费</td><td>0.002%</td><td>买卖都收</td></tr><tr><td>佣金</td><td>券商定，常见万 1–万 3</td><td>买卖都收</td></tr></table>
<p>大多数券商的佣金已经包含经手费和证管费。佣金单笔最低 5 元，「免五」就是不设这个最低值。ETF 免印花税和过户费。</p><div class="eg">卖出 10,000 元股票（万 2.5，最低 5 元）：佣金 5.00 + 印花税 5.00 + 过户费 0.10 = 10.10 元。<br>买入 2,000 元：佣金按 0.50 算，但最低收 5 元，相当于 0.25%。小额交易要么用免五账户，要么少交易。</div>
<p>红利税见下一课。</p>`,
    quiz: [{ q: '卖出 20,000 元股票（佣金万 2.5、最低 5 元、规费含在佣金里），总费用是？', o: ['5.20 元', '15.20 元', '25.20 元'], a: 1, e: '佣金 max(5.00, 5) = 5.00，印花税 10.00，过户费 0.20，合计 15.20。' }, { q: 'ETF 卖出要交印花税吗？', o: ['要，0.05%', '不要'], a: 1, e: 'ETF 免征印花税，也不收过户费。' }], practice: ['feeCalc', '去费用计算器'], pass: 's0-p0' },
  { id: 'div', title: '红利税（股息红利差别化个税）', body: `<p>上市公司分红时，现金<b>全额</b>打到你的账户，当时不扣税。等你卖出时，券商按你的持股时间补扣：</p><table class="t"><tr><th>持股期限</th><th>税负</th></tr><tr><td>≤ 1 个月</td><td>20%</td></tr><tr><td>1 个月–1 年</td><td>10%</td></tr><tr><td>＞ 1 年</td><td>免税</td></tr></table><p>持股期限从买入日算到卖出日的前一天。分几次买入的，卖出时按<b>先进先出</b>认定卖的是哪一批。税款在卖出后的下一个交易日从资金账户扣，交割单上叫「股息红利税补」。</p><div class="eg">示例账户 6 月 2 日买入招商银行 2000 股，7 月 10 日每股分红 2.00 元（示例数据）。现在卖出：持股超过 1 个月不到 1 年，补税 4000 × 10% = 400 元。</div>`,
    quiz: [{ q: '上面的例子如果等到明年 6 月 3 日以后再卖，要补多少税？', o: ['400 元', '800 元', '0 元'], a: 2, e: '持股超过 1 年，股息红利暂免个税。' }], practice: ['order:S:sh600036', '去卖出招商银行看提示'] },
  { id: 'exright', title: '除权除息与复权', body: `<p>分红、送股后，股价会做一次调整，否则相当于凭空多出钱：</p><ul><li>除息参考价 = 前收盘价 − 每股现金红利</li><li>除权参考价 = (前收盘价 − 每股现金红利) ÷ (1 + 每股送转比例)</li></ul><p>K 线图上会因此出现一个「缺口」，这不是真跌了。算收益、做回测时要用<b>复权</b>价格：前复权（以最新价为基准往前调）适合看图，后复权适合算长期收益。</p><p>阶段 3 的数据库要单独存复权因子，这样两种复权都能算出来。</p>`,
    quiz: [{ q: '前收 20.00 元，每股派现 0.50 元，除息参考价是？', o: ['19.50', '20.00', '19.00'], a: 0, e: '20.00 − 0.50 = 19.50。' }] },
  { id: 'st', title: 'ST 与退市风险', body: `<p>股票简称前面带 ST，表示公司被实施了「其他风险警示」，比如财务或治理有问题；*ST 表示有退市风险。</p><ul><li>2026-07-06 起，主板 ST、*ST 的涨跌幅由 ±5% 调整为 ±10%，和主板其他股票一致。</li><li>买入风险警示股票前要签风险揭示书，单只股票每天累计买入有数量上限 ⚠️（以券商提示为准）。</li><li>进入退市整理期的股票简称会带「退」，整理期结束后摘牌。</li></ul><p>路线图阶段 3 要求股票池能识别某一天哪些股票是 ST，因为很多策略会排除它们。</p>`,
    quiz: [{ q: '2026 年 10 月，主板 ST 股的涨跌幅限制是？', o: ['±5%', '±10%', '±20%'], a: 1, e: '2026-07-06 起由 5% 调整为 10%。' }] },
  { id: 'ipo', title: '新股上市前 5 日', body: `<p>主板、创业板、科创板的新股，上市后前 5 个交易日不设涨跌幅限制，从第 6 个交易日起按板块比例限制。</p><p>为了防止过度炒作，这几天盘中涨跌幅度较大时会临时停牌 ⚠️（具体阈值以交易所规则为准），连续竞价阶段仍然有价格笼子。</p><p>本 App V1 不做新股申购：真实中签是随机抽签，模拟结果必然和现实不一致。</p>`,
    quiz: [{ q: '一只主板新股上市第 3 个交易日，有涨跌幅限制吗？', o: ['有，±10%', '有，±20%', '没有'], a: 2, e: '前 5 个交易日不设涨跌幅限制。' }] },
  { id: 'boards', title: '各板块差异', body: `<div class="scroll-x"><table class="t"><tr><th></th><th>主板</th><th>创业板</th><th>科创板</th><th>ETF</th></tr><tr><td>代码</td><td>60/00</td><td>30</td><td>688</td><td>51/56/58/159</td></tr><tr><td>涨跌幅</td><td>±10%</td><td>±20%</td><td>±20%</td><td>±10%，跟踪创业板/科创板指数的 ±20%</td></tr><tr><td>申报</td><td>100 股</td><td>100 股</td><td>≥200 股</td><td>100 份</td></tr><tr><td>价格笼子</td><td>2% 或 0.1 元</td><td>2% 或 0.1 元</td><td>2%</td><td>待核实</td></tr><tr><td>印花税</td><td>卖 0.05%</td><td>卖 0.05%</td><td>卖 0.05%</td><td>免</td></tr><tr><td>开通门槛</td><td>无</td><td>10 万 + 24 个月</td><td>50 万 + 24 个月</td><td>无</td></tr></table></div><p>开通门槛指前 20 个交易日日均资产和交易经验。模拟账户里不限制，但下单时会提示你真实账户需要先开通权限。</p>`,
    quiz: [{ q: '688 开头的股票一笔最少买多少？', o: ['100 股', '200 股'], a: 1, e: '科创板 200 股起。' }] },
  { id: 'kinds', title: '委托类型：限价与市价', body: `<p><b>限价委托</b>：指定价格，只会以这个价格或更好的价格成交。新手默认用它。</p><p><b>市价委托</b>只在连续竞价阶段可用，沪深不一样：</p><ul><li>沪市：最优五档即时成交剩余撤销、最优五档即时成交剩余转限价</li><li>深市：对手方最优、本方最优、即时成交剩余撤销、最优五档即时成交剩余撤销、全额成交或撤销</li></ul><p>市价买单冻结资金按涨停价计算，所以可买数量会比限价少。小票盘口薄，市价单可能一次吃掉好几档，成交价比你看到的最新价差不少。</p>`,
    quiz: [{ q: '9:20 能下市价单吗？', o: ['能', '不能，集合竞价只收限价单'], a: 1, e: '市价单只在连续竞价阶段接受。' }] }
];
SCREENS.lessons = {
  title: '规则课',
  render() { return '<div class="sec">' + LESSONS.map((l, i) => '<div class="row tap" onclick="go(\'lesson\',{id:\'' + l.id + '\'})"><span class="n muted" style="width:22px">' + (i + 1) + '</span><span class="grow">' + l.title + '</span>' + (S.lessonDone[l.id] ? '<span class="ok" style="font-size:12px">已通过</span>' : '') + '<span class="chev"></span></div>').join('') + '</div>'; }
};
SCREENS.lesson = {
  title: p => LESSONS.find(l => l.id === p.id).title,
  render(p) {
    const l = LESSONS.find(x => x.id === p.id);
    let h = '<div class="lesson">' + l.body + '</div>';
    l.quiz.forEach((q, qi) => {
      const ans = S.quiz[l.id + qi];
      h += '<div class="quiz" style="border-top:8px solid var(--bg)"><div class="q">小测 ' + (qi + 1) + '：' + q.q + '</div>' + q.o.map((o, oi) => '<button class="op' + (ans != null ? (oi === q.a ? ' right' : oi === ans ? ' wrong' : '') : '') + '" onclick="answer(\'' + l.id + '\',' + qi + ',' + oi + ')">' + o + '</button>').join('') + (ans != null ? '<div class="note ' + (ans === q.a ? 'lt' : 'warn') + '">' + (ans === q.a ? '答对了。' : '再想想：') + q.e + '</div>' : '') + '</div>';
    });
    if (l.practice) h += '<div style="padding:12px 14px;background:#fff;border-top:8px solid var(--bg)"><button class="btn lt block" onclick="practice(\'' + l.practice[0] + '\')">' + l.practice[1] + '</button></div>';
    return h + '<div style="height:16px"></div>';
  }
};
function answer(id, qi, oi) {
  S.quiz[id + qi] = oi;
  const l = LESSONS.find(x => x.id === id);
  if (l.quiz.every((q, i) => S.quiz[id + i] === q.a)) { S.lessonDone[id] = true; if (l.pass) autoCheck(l.pass, '能说清一笔股票买卖要交哪些费用'); }
  refresh();
}
function practice(k) {
  const [a, b, c] = k.split(':');
  if (a === 'stock') return go('stock', { code: b });
  if (a === 'order') return go('order', { side: b, code: c });
  if (a === 'trade') return tab('trade');
  if (a === 'orders') return go('orders', { tab: 'today' });
  go(a);
}

// ---------- 费用计算器 ----------
const FC = { code: 'sh600519', price: 1336.78, qty: 100 };
SCREENS.feeCalc = {
  title: '费用计算器',
  render() {
    const s = SEC[FC.code];
    return '<div class="sec" style="padding:12px 14px;display:flex;flex-direction:column;gap:8px"><div class="fld"><select onchange="FC.code=this.value;FC.price=lastPx(this.value);refresh()">' + STOCKS.map(c => '<option value="' + c + '"' + (c === FC.code ? ' selected' : '') + '>' + SEC[c].name + ' ' + SEC[c].sym + '（' + BOARD_NAME[SEC[c].board] + '）</option>').join('') + '</select></div>' +
      '<div style="display:flex;gap:8px"><div class="fld" style="flex:1"><input value="' + FC.price + '" oninput="FC.price=parseFloat(this.value)||0;SCREENS.feeCalc.out()" aria-label="价格"></div><div class="fld" style="flex:1"><input value="' + FC.qty + '" oninput="FC.qty=parseInt(this.value)||0;SCREENS.feeCalc.out()" aria-label="数量"></div></div>' +
      '<div class="muted" style="font-size:12px">费率来自「我的 → 费率设置」：股票万 ' + (S.fee.rate * 1e4).toFixed(2) + '，ETF 万 ' + (S.fee.etfRate * 1e4).toFixed(2) + '，' + (S.fee.mian5 ? '免五' : '最低 5 元') + '</div></div><div id="fco"></div>';
  },
  after() { this.out(); },
  out() {
    const amt = r2(FC.price * FC.qty), b = calcFee(FC.code, 'B', amt), sl = calcFee(FC.code, 'S', amt);
    const row = (n, x, y) => '<tr><td>' + n + '</td><td>' + money(x) + '</td><td>' + money(y) + '</td></tr>';
    const be = (b.total + sl.total) / amt * 100;
    $('#fco').innerHTML = '<div class="sec"><table class="t n"><tr><th>成交金额 ' + money(amt) + '</th><th>买入</th><th>卖出</th></tr>' + row('佣金', b.commission, sl.commission) + row('印花税', b.stamp, sl.stamp) + row('过户费', b.transfer, sl.transfer) + (S.fee.regsSeparate ? row('经手费', b.handling, sl.handling) + row('证管费', b.reg, sl.reg) : '') + '<tr><td><b>合计</b></td><td><b>' + money(b.total) + '</b></td><td><b>' + money(sl.total) + '</b></td></tr></table>' +
      '<div style="padding:10px 14px" class="ink2">买卖一个来回 <b class="n">' + money(b.total + sl.total) + '</b> 元，约占成交额 <b class="n">' + fx(be, 3) + '%</b>。也就是说股价至少要涨 ' + fx(be, 3) + '% 才能保本。' + (b.commission === (SEC[FC.code].board === 'etf' ? S.fee.etfMin : S.fee.min) && !S.fee.mian5 ? '<div class="note warn" style="margin-top:6px">这笔佣金触发了最低 5 元，小额交易的费率实际上被放大了。</div>' : '') + '</div></div>';
  }
};

// ---------- 集合竞价演示 ----------
let AUC = null;
function aucReset() { AUC = { prev: 10.00, buys: [[10.05, 300], [10.02, 500], [10.00, 800], [9.98, 600]], sells: [[9.95, 200], [9.99, 400], [10.01, 700], [10.03, 600]], done: false }; }
function aucCalc() {
  const prices = [...new Set(AUC.buys.concat(AUC.sells).map(x => x[0]))].sort((a, b) => b - a);
  const rows = prices.map(p => { const B = AUC.buys.filter(x => x[0] >= p - 1e-9).reduce((a, x) => a + x[1], 0), Sx = AUC.sells.filter(x => x[0] <= p + 1e-9).reduce((a, x) => a + x[1], 0); return { p, B, S: Sx, v: Math.min(B, Sx), imb: Math.abs(B - Sx) }; });
  let best = null; for (const r of rows) if (!best || r.v > best.v || (r.v === best.v && (r.imb < best.imb || (r.imb === best.imb && Math.abs(r.p - AUC.prev) < Math.abs(best.p - AUC.prev))))) best = r;
  return { rows, best };
}
SCREENS.auction = {
  title: '集合竞价演示',
  render() {
    if (!AUC) aucReset();
    const { rows, best } = aucCalc();
    let h = '<div class="sec" style="padding:12px 14px;font-size:13px" class="ink2">一只前收 10.00 的股票，9:15–9:25 攒了下面这些单。对每个可能的价格，算出「愿意以这个价或更高买的量」和「愿意以这个价或更低卖的量」，两者较小的就是这个价格能成交的量。<b>成交量最大</b>的价格就是开盘价。</div>';
    h += '<div class="sec"><table class="t n auc"><tr><th>价格</th><th>累计买量 ≥价</th><th>累计卖量 ≤价</th><th>可成交量</th></tr>' + rows.map(r => { const hl = r === best ? ' class="hl"' : ''; return '<tr><td' + hl + '>' + fx(r.p, 2) + '</td><td' + hl + '>' + r.B + '</td><td' + hl + '>' + r.S + '</td><td' + hl + '>' + r.v + '</td></tr>'; }).join('') + '</table>' +
      '<div style="padding:10px 14px">开盘价 <b class="n up" style="font-size:18px">' + fx(best.p, 2) + '</b>，成交 <b class="n">' + best.v + '</b> 手。所有买价 ≥ ' + fx(best.p, 2) + ' 的买单和卖价 ≤ ' + fx(best.p, 2) + ' 的卖单都按 ' + fx(best.p, 2) + ' 成交（量不够时按价格、时间优先分配）。</div></div>';
    h += '<div class="sec" style="padding:12px 14px"><div style="font-weight:600;margin-bottom:6px">加一笔单，看开盘价怎么变</div><div style="display:flex;gap:6px"><div class="fld" style="flex:1"><select id="aside"><option value="b">买入</option><option value="s">卖出</option></select></div><div class="fld" style="flex:1"><input id="apx" value="10.04" aria-label="价格"></div><div class="fld" style="flex:1"><input id="aqty" value="1000" aria-label="手数"></div></div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn lt sm" onclick="aucAdd()">加入</button><button class="btn ghost sm" onclick="aucReset();refresh()">重置</button></div>' +
      '<div class="muted" style="font-size:12px;margin-top:6px">买单：' + AUC.buys.map(x => fx(x[0], 2) + '×' + x[1]).join('、') + '<br>卖单：' + AUC.sells.map(x => fx(x[0], 2) + '×' + x[1]).join('、') + '</div></div>';
    h += '<div class="quiz"><div class="q">你出价 10.05 买入 100 手，开盘价 ' + fx(best.p, 2) + '，你的成交价是？</div>' + ['10.05', fx(best.p, 2)].map((o, i) => '<button class="op' + (AUC.ans != null ? (i === 1 ? ' right' : i === AUC.ans ? ' wrong' : '') : '') + '" onclick="AUC.ans=' + i + ';if(' + i + '===1)autoCheck(\'s0-p1\',\'能解释集合竞价的成交价就是开盘价\');refresh()">' + o + '</button>').join('') + (AUC.ans != null ? '<div class="note lt">集合竞价只产生一个价格，所有成交都用它。所以早上预埋的单，成交价就是开盘价，而不是你的委托价。</div>' : '') + '</div>';
    return h;
  }
};
function aucAdd() { const sd = $('#aside').value, p = roundTo(parseFloat($('#apx').value), 0.01), q = parseInt($('#aqty').value); if (!(p > 0 && q > 0)) return; (sd === 'b' ? AUC.buys : AUC.sells).push([p, q]); refresh(); }

// ---------- 阶段 1：数据练习 ----------
function yearStats(code) {
  const k = DATA.kline[code]; const out = [];
  const years = [...new Set(k.map(r => r[0].slice(0, 4)))];
  for (const y of years) {
    const rs = k.filter(r => r[0].startsWith(y)); const prevBar = k[k.indexOf(rs[0]) - 1];
    const base = prevBar ? prevBar[2] : rs[0][1];
    out.push({ y: y + (prevBar ? '' : '（' + rs[0][0].slice(5) + ' 起）') + (y === '2026' ? ' 至今' : ''), ret: (rs[rs.length - 1][2] / base - 1) * 100 });
  }
  const rets = k.slice(1).map((r, i) => r[2] / k[i][2] - 1);
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100;
  let peak = k[0][2], pd = k[0][0], mdd = 0, mddS = '', mddE = '';
  for (const r of k) { if (r[2] > peak) { peak = r[2]; pd = r[0]; } const dd = r[2] / peak - 1; if (dd < mdd) { mdd = dd; mddS = pd; mddE = r[0]; } }
  const roll = (k[k.length - 1][2] / k[k.length - 251][2] - 1) * 100;
  return { out, vol, mdd: mdd * 100, mddS, mddE, roll, n: k.length, first: k[0][0], last: k[k.length - 1][0] };
}
function rank20() {
  const rows = STOCKS.map(c => { const k = DATA.kline[c]; const n = k.length; return { c, r: (k[n - 1][2] / k[n - 21][2] - 1) * 100, d: k[n - 1][0] }; }).filter(x => x.d === TODAY_REAL);
  rows.sort((a, b) => b.r - a.r); rows.forEach((x, i) => x.rank = i + 1); return rows;
}
let dlShow = {};
SCREENS.datalab = {
  title: '数据练习（阶段 1）',
  render() {
    let h = '<div class="note lt" style="margin:10px">Python 在电脑上写。App 负责两件事：给你干净的数据（CSV），以及用同一份数据算出「标准答案」，方便你核对 pandas 的结果。</div>';
    h += '<div class="sec"><div class="sec-h">数据集</div>' + [['sh000300', '沪深300 指数日线'], ['sh000906', '中证800 指数日线'], ['all', '30 只股票前复权日线（长表）'], ['ledger', '我的交割单']].map(([k, l]) => '<div class="row"><div class="grow">' + l + '<div class="muted" style="font-size:11px">' + (k === 'all' ? STOCKS.length + ' 只 × 约 250 天 · date, code, open, close, high, low, volume' : k === 'ledger' ? S.ledger.length + ' 条' : DATA.kline[k].length + ' 行 · ' + DATA.kline[k][0][0] + ' → ' + DATA.kline[k][DATA.kline[k].length - 1][0]) + '</div></div><button class="btn sm ghost" onclick="exportData(\'' + k + '\')">下载 CSV</button></div>').join('') + '</div>';
    h += '<div class="sec"><div class="sec-h">练习 1：指数的收益和风险</div><div style="padding:0 14px 10px;font-size:13px" class="ink2">算沪深300、中证800 每年收益率、年化波动率、最大回撤、最近一年滚动收益。</div>' +
      '<div style="padding:0 14px 10px;display:flex;gap:8px"><button class="btn sm ghost" onclick="dlShow.h1=!dlShow.h1;refresh()">' + (dlShow.h1 ? '收起提示' : '看提示') + '</button><button class="btn sm lt" onclick="dlShow.a1=!dlShow.a1;refresh()">' + (dlShow.a1 ? '收起答案' : '对答案') + '</button></div>';
    if (dlShow.h1) h += '<pre class="mono" style="margin:0 14px 10px;background:#F7F8FA;padding:8px;border-radius:6px;overflow:auto">df = pd.read_csv("沪深300.csv", parse_dates=["date"], index_col="date")\nret = df["close"].pct_change()\nyearly = df["close"].resample("YE").last().pct_change()\nvol = ret.std() * 252 ** 0.5\ndd = df["close"] / df["close"].cummax() - 1\nroll = df["close"].pct_change(250)</pre>';
    if (dlShow.a1) for (const c of ['sh000300', 'sh000906']) { const st = yearStats(c); h += '<div style="padding:0 14px 10px"><b>' + SEC[c].name + '</b><table class="t n">' + st.out.map(o => '<tr><td>' + o.y + '</td><td class="' + cls(o.ret) + '">' + pctS(o.ret) + '</td></tr>').join('') + '<tr><td>年化波动率（日收益标准差 × √252）</td><td>' + fx(st.vol, 2) + '%</td></tr><tr><td>最大回撤 ' + st.mddS + ' → ' + st.mddE + '</td><td class="down">' + fx(st.mdd, 2) + '%</td></tr><tr><td>最近 250 个交易日滚动收益</td><td class="' + cls(st.roll) + '">' + pctS(st.roll) + '</td></tr></table></div>'; }
    h += '</div><div class="sec"><div class="sec-h">练习 2：截面排名（通关标准）</div><div style="padding:0 14px 10px;font-size:13px" class="ink2">不写 for 循环，算出每只股票过去 20 日收益在当天的排名。</div><div style="padding:0 14px 10px;display:flex;gap:8px"><button class="btn sm ghost" onclick="dlShow.h2=!dlShow.h2;refresh()">' + (dlShow.h2 ? '收起提示' : '看提示') + '</button><button class="btn sm lt" onclick="dlShow.a2=!dlShow.a2;refresh()">' + (dlShow.a2 ? '收起答案' : '对答案（' + TODAY_REAL + '）') + '</button></div>';
    if (dlShow.h2) h += '<pre class="mono" style="margin:0 14px 10px;background:#F7F8FA;padding:8px;border-radius:6px;overflow:auto">px = df.pivot(index="date", columns="code", values="close")\nr20 = px.pct_change(20)\nrank = r20.rank(axis=1, ascending=False)</pre>';
    if (dlShow.a2) h += '<div style="padding:0 14px 10px"><table class="t n"><tr><th>排名</th><th>股票</th><th>20 日收益</th></tr>' + rank20().map(x => '<tr><td>' + x.rank + '</td><td style="text-align:left">' + SEC[x.c].name + '</td><td class="' + cls(x.r) + '">' + pctS(x.r) + '</td></tr>').join('') + '</table><div class="muted" style="font-size:11px;margin-top:4px">用前复权收盘价；今天的收盘价是 11:30 的价格。</div></div>';
    return h + '</div>';
  }
};
function exportData(k) {
  if (k === 'ledger') return exportLedger();
  if (k === 'all') { const lines = ['date,code,open,close,high,low,volume']; for (const c of STOCKS) for (const r of DATA.kline[c]) lines.push([r[0], SEC[c].sym, r[1], r[2], r[3], r[4], r[5]].join(',')); return download('stocks_qfq_day.csv', lines.join('\n')); }
  download(SEC[k].name + '.csv', ['date,open,close,high,low,volume'].concat(DATA.kline[k].map(r => r.join(','))).join('\n'));
}

// ---------- 阶段 2：账户分析 ----------
let anBench = 'sh000300', anOpen = {};
function analysisData() {
  const hist = S.equityHist.slice();
  const a = account();
  if (!hist.length || hist[hist.length - 1].date !== today()) hist.push({ date: today(), total: r2(a.total), deposit: S.depositTotal, live: true });
  const bk = liveBars(anBench); const bmap = {}; bk.forEach(r => bmap[r[0]] = r[2]);
  const rows = hist.filter(h => bmap[h.date] != null);
  const rp = [], rb = [], dates = [];
  for (let i = 1; i < rows.length; i++) { const flow = rows[i].deposit - rows[i - 1].deposit; rp.push((rows[i].total - flow) / rows[i - 1].total - 1); rb.push(bmap[rows[i].date] / bmap[rows[i - 1].date] - 1); dates.push(rows[i].date); }
  const n = rp.length, mean = x => x.reduce((s, v) => s + v, 0) / x.length, sd = x => { const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)); };
  const cum = x => { let c = 1; return x.map(v => (c *= 1 + v) - 1); };
  const cp = cum(rp), cb = cum(rb);
  const rf = 0.015 / 252;
  const ex = rp.map((v, i) => v - rb[i]);
  const mp = mean(rp), mb = mean(rb);
  const cov = rp.reduce((s, v, i) => s + (v - mp) * (rb[i] - mb), 0) / (n - 1), vb = sd(rb) ** 2;
  const beta = cov / vb, alpha = ((mp - rf) - beta * (mb - rf)) * 252;
  const te = sd(ex) * Math.sqrt(252), ir = mean(ex) * 252 / te;
  const tstat = mean(ex) / (sd(ex) / Math.sqrt(n));
  let peak = 1, mdd = 0, c = 1; for (const v of rp) { c *= 1 + v; peak = Math.max(peak, c); mdd = Math.min(mdd, c / peak - 1); }
  const totR = cp[n - 1], annR = Math.pow(1 + totR, 252 / n) - 1, vol = sd(rp) * Math.sqrt(252), sharpe = (mp - rf) / sd(rp) * Math.sqrt(252);
  return { n, dates, cp, cb, rp, rb, totR, bTot: cb[n - 1], annR, vol, sharpe, mdd, beta, alpha, te, ir, tstat, mp, mb, from: rows[0].date };
}
SCREENS.analysis = {
  title: '账户分析（阶段 2）',
  render() {
    const d = analysisData();
    let h = '<div class="seg lt">' + [['sh000300', '基准：沪深300'], ['sh000906', '基准：中证800']].map(([k, l]) => '<button class="' + (anBench === k ? 'on' : '') + '" onclick="anBench=\'' + k + '\';refresh()">' + l + '</button>').join('') + '</div>';
    h += '<div class="sec"><canvas class="chart" id="ancv"></canvas><div class="muted" style="font-size:11px;padding:0 14px 8px">' + d.from + ' 起 ' + d.n + ' 个交易日，用时间加权收益（扣掉入金出金的影响）</div></div>';
    if (d.n < 20) h += '<div class="note warn" style="margin:0 10px 8px">样本少于 20 个交易日，下面的指标不具备统计意义。</div>';
    const M = (id, name, val, f) => '<div class="metric" onclick="anOpen.' + id + '=!anOpen.' + id + ';refresh()"><span>' + name + '</span><b class="n">' + val + '</b></div>' + (anOpen[id] ? '<div class="formula n">' + f + '</div>' : '');
    const P = v => fx(v * 100, 2) + '%';
    h += '<div class="sec">' +
      M('tr', '累计收益 / 基准', P(d.totR) + ' / ' + P(d.bTot), '累计收益 = ∏(1 + r<sub>t</sub>) − 1，r<sub>t</sub> = (当日总资产 − 当日净入金) ÷ 前日总资产 − 1') +
      M('ar', '年化收益', P(d.annR), '(1 + ' + P(d.totR) + ')^(252 / ' + d.n + ') − 1 = ' + P(d.annR) + '<br>天数少时年化会把偶然放大，看看就好。') +
      M('vol', '年化波动率', P(d.vol), '日收益标准差 × √252') +
      M('sh', '夏普比率', fx(d.sharpe, 2), '(日均收益 − 无风险日收益) ÷ 日收益标准差 × √252<br>无风险利率按年 1.5% 计（可在设置里改）') +
      M('dd', '最大回撤', P(d.mdd), '净值从历史最高点回落的最大幅度：min(净值 ÷ 历史最高净值 − 1)') +
      M('beta', 'Beta', fx(d.beta, 2), 'cov(r<sub>p</sub>, r<sub>b</sub>) ÷ var(r<sub>b</sub>)<br>Beta = 1 表示和基准同涨同跌；你的组合里有 ETF 和银行股，Beta 通常小于 1。') +
      M('al', 'Alpha（年化）', P(d.alpha), '[(r̄<sub>p</sub> − r<sub>f</sub>) − β × (r̄<sub>b</sub> − r<sub>f</sub>)] × 252<br>= [(' + fx(d.mp * 1e4, 2) + '‱ − 0.60‱) − ' + fx(d.beta, 2) + ' × (' + fx(d.mb * 1e4, 2) + '‱ − 0.60‱)] × 252') +
      M('te', '跟踪误差', P(d.te), '超额日收益 (r<sub>p</sub> − r<sub>b</sub>) 的标准差 × √252') +
      M('ir', '信息比率', fx(d.ir, 2), '年化超额 ÷ 跟踪误差。机构指数增强产品长期能做到 1 以上就很好。') +
      M('t', '超额的 t 统计量', fx(d.tstat, 2), '均值 ÷ (标准差 ÷ √n) = 超额日均 ÷ 标准误<br>|t| ＞ 2 才勉强说「可能不是运气」。' + d.n + ' 天的样本远远不够；而且你试的策略越多，越容易碰巧得到一个好看的 t 值（多重检验）。') +
      '</div><div style="padding:10px"><button class="btn lt block" onclick="openAI(\'analysis\')">让 AI 用这些数字解释我的账户</button></div>';
    return h;
  },
  after() {
    const d = analysisData();
    drawLines($('#ancv'), [{ name: '我的账户', color: '#E5322D', data: d.cp.map(v => v * 100) }, { name: SEC[anBench].name, color: '#2B6DE5', data: d.cb.map(v => v * 100) }, { name: '超额', color: '#0F7B76', data: d.cp.map((v, i) => (v - d.cb[i]) * 100), width: 1 }], { zero: 0, labels: [d.dates[0], d.dates[d.dates.length - 1]], fmt: v => fx(v, 1) + '%' });
  }
};

// ---------- 阶段 3：数据中心 ----------
let dcDate = '2026-10-23', dcUpd = null;
function qualityChecks() {
  const res = [];
  let ok = 0, bad = [];
  for (const c of STOCKS) { const q = DATA.quotes[c]; if (!(q.up > 0)) continue; const lp = limitPrices(c, q.prev); if (Math.abs(lp.up - q.up) < 1e-9 && Math.abs(lp.down - q.down) < 1e-9) ok++; else bad.push(SEC[c].name + ' 接口 ' + q.up + '/' + q.down + ' 自算 ' + lp.up + '/' + lp.down); }
  res.push({ name: '涨跌停价：接口值 vs 按规则自算', ok: !bad.length, detail: ok + ' 只一致' + (bad.length ? '；不一致：' + bad.join('；') : '') });
  const cal = DATA.kline.sh000300.map(r => r[0]); const miss = [];
  for (const c of STOCKS) { const ds = new Set(DATA.kline[c].map(r => r[0])); const first = DATA.kline[c][0][0]; const m = cal.filter(d => d >= first && !ds.has(d)); if (m.length) miss.push(SEC[c].name + ' 缺 ' + m.length + ' 天（' + m.slice(0, 3).join('、') + (m.length > 3 ? '…' : '') + '）'); }
  res.push({ name: '日线日期 vs 交易日历（缺失 = 停牌或数据缺失）', ok: !miss.length, detail: miss.length ? miss.join('；') : '全部连续' });
  const jumps = [];
  for (const c of STOCKS) { const k = DATA.kline[c], lim = SEC[c].limitPct + 0.005; for (let i = 1; i < k.length; i++) { const r = k[i][2] / k[i - 1][2] - 1; if (Math.abs(r) > lim) jumps.push(SEC[c].name + ' ' + k[i][0] + ' ' + pctS(r * 100)); } }
  res.push({ name: '价格跳变：单日涨跌超过涨跌停比例', ok: !jumps.length, detail: jumps.length ? jumps.slice(0, 5).join('；') + '（前复权价，需要人工确认是否复权断档）' : '没有发现' });
  res.push({ name: '腾讯 vs 新浪收盘价交叉核对', ok: null, detail: '原型不联网。真实 App 每天收盘后抽查，差异 ＞ 0.01 元标红。' });
  res.push({ name: '财务数据按公告日对齐（防未来函数）', ok: null, detail: 'V1 只存公告日期和报告期，查询时按「公告日 ≤ 查询日」过滤。' });
  return res;
}
SCREENS.datacenter = {
  title: '数据中心（阶段 3）',
  render() {
    const klRows = Object.values(DATA.kline).reduce((a, k) => a + k.length, 0), mnRows = Object.values(DATA.minute).reduce((a, k) => a + k.length, 0);
    let h = '<div class="note lt" style="margin:10px">App 的本地库就是一个小号的阶段 3 作业：表怎么设计、怎么增量更新、怎么检查数据可信。电脑上的版本用 DuckDB / parquet，结构可以照抄。</div>';
    h += '<div class="sec"><div class="sec-h">本地表 <small>SQLite</small></div><table class="t n">' + [['security', '证券列表（板块、ST、上市日）', Object.keys(SEC).length], ['trade_calendar', '交易日历', CAL.length], ['kline_day', '日线（前复权 + 复权因子）', klRows], ['minute', '分时（当日）', mnRows], ['quote_snapshot', '最新快照（含五档、涨跌停价）', Object.keys(DATA.quotes).length], ['order / fill', '委托 / 成交', S.orders.length + ' / ' + S.fills.length], ['position_lot', '持仓批次（T+1、红利税用）', S.lots.length], ['cash_ledger', '资金流水', S.flows.length]].map(r => '<tr><td style="text-align:left" class="mono">' + r[0] + '</td><td style="text-align:left;font-family:var(--zh)">' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</table>' +
      '<div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center"><span class="muted" style="font-size:12px">最近更新：' + (dcUpd || DATA.fetchedAt + '（腾讯接口）') + '</span><button class="btn sm lt" onclick="dcUpd=today()+\' \'+hms(S.t)+\'（增量 0 行，已是最新）\';refresh();showToast(\'增量更新：只拉最后一个交易日之后的数据\')">增量更新</button></div></div>';
    h += '<div class="sec"><div class="sec-h">数据质量检查</div>' + qualityChecks().map(c => '<div class="row" style="align-items:flex-start"><span class="' + (c.ok === true ? 'ok' : c.ok === false ? 'no' : 'muted') + '" style="width:16px">' + (c.ok === true ? '✓' : c.ok === false ? '!' : '–') + '</span><div class="grow"><div>' + c.name + '</div><div class="muted" style="font-size:12px">' + esc(c.detail) + '</div></div></div>').join('') + '</div>';
    const ds = DATA.kline.sh000300.map(r => r[0]).filter(d => d >= '2025-10-15').reverse();
    h += '<div class="sec"><div class="sec-h">某一天的股票状态 <small>通关标准</small></div><div style="padding:0 14px 8px"><div class="fld"><select onchange="dcDate=this.value;refresh()">' + ds.map(d => '<option' + (d === dcDate ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></div></div><div class="scroll-x"><table class="t n"><tr><th>股票</th><th>板块</th><th>收盘</th><th>涨跌</th><th>状态</th></tr>' +
      STOCKS.map(c => { const k = DATA.kline[c], i = k.findIndex(r => r[0] === dcDate); if (i < 0) return '<tr><td style="text-align:left">' + SEC[c].name + '</td><td>' + BOARD_NAME[SEC[c].board] + '</td><td>--</td><td>--</td><td class="no">停牌/未上市</td></tr>'; const r = k[i], pv = i ? k[i - 1][2] : r[1], lp = limitPrices(c, pv); const st = []; if (Math.abs(r[1] - lp.up) < SEC[c].tick / 2) st.push('开盘涨停'); if (Math.abs(r[1] - lp.down) < SEC[c].tick / 2) st.push('开盘跌停'); if (Math.abs(r[2] - lp.up) < SEC[c].tick / 2) st.push('收盘涨停'); if (SEC[c].st) st.push('ST'); return '<tr><td style="text-align:left">' + SEC[c].name + '</td><td>' + BOARD_NAME[SEC[c].board] + '</td><td>' + fx(r[2], SEC[c].dec) + '</td><td class="' + cls(r[2] - pv) + '">' + pctS((r[2] / pv - 1) * 100) + '</td><td>' + (st.join(' ') || '正常') + '</td></tr>'; }).join('') + '</table></div><div class="muted" style="font-size:11px;padding:6px 14px 10px">原型用前复权价近似判断；真实 App 用当天的不复权价和当天的涨跌停价。ST 状态原型只用当前名称，真实 App 要存历史变更。</div></div>';
    return h;
  }
};

// ---------- 阶段 7：模拟执行 ----------
function weekOf(d) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); }
SCREENS.exec = {
  title: '模拟执行（阶段 7）', liveRefresh: true,
  render() {
    const wk = weekOf(today());
    const doneWeeks = new Set(S.orders.filter(o => o.src === 'plan' && o.filled > 0).map(o => weekOf(CAL[o.di])));
    if (doneWeeks.size >= 12) autoCheck('s7-e0', '连续 12 周执行');
    let h = '<div class="sec"><div class="sec-h">连续执行 <small>' + doneWeeks.size + ' / 12 周</small></div><div class="weeks">' + Array.from({ length: 12 }, (_, i) => '<i class="' + (i < doneWeeks.size ? 'ok' : i === doneWeeks.size ? 'cur' : '') + '">' + (i + 1) + '</i>').join('') + '</div></div>';
    h += '<div class="sec"><div class="sec-h">本周调仓清单 <small>' + wk + ' 这一周</small></div><table class="t n"><tr><th>股票</th><th>当前</th><th>目标</th><th>操作</th></tr>' + S.plan.map(pl => { const a = availableQty(pl.code); const d = pl.target - a.held; return '<tr><td style="text-align:left">' + SEC[pl.code].name + '<div class="muted" style="font-size:11px;font-family:var(--zh)">' + esc(pl.note) + '</div></td><td>' + intf(a.held) + '</td><td>' + intf(pl.target) + '</td><td class="' + (d > 0 ? 'up' : d < 0 ? 'down' : 'muted') + '">' + (d > 0 ? '买 ' + intf(d) : d < 0 ? '卖 ' + intf(-d) : '不动') + '</td></tr>'; }).join('') + '</table>' +
      '<div class="note" style="margin:8px 14px">固定规则：买入挂「现价 +2%」、卖出挂「现价 −2%」的限价单，参加下一交易日开盘集合竞价，保证大概率按开盘价成交。未成交的单子收盘后系统撤销，下一个交易日按同样规则补单。</div>' +
      '<div style="padding:0 14px 12px;display:flex;gap:8px"><button class="btn lt" style="flex:1" onclick="genPlanOrders()">生成下一交易日预埋单</button><button class="btn ghost" onclick="showToast(\'真实 App 支持导入电脑上生成的 CSV：code,target\')">导入 CSV</button></div></div>';
    const po = S.orders.filter(o => o.src === 'plan');
    if (po.length) h += '<div class="sec"><div class="sec-h">执行记录 <small>成交价 vs 开盘价</small></div>' + po.map(o => { const op = MK[o.code] && CAL[o.di] === today() ? MK[o.code].open : null; const avg = o.filled ? o.amt / o.filled : null; return '<div class="row" onclick="go(\'orderDetail\',{id:' + o.id + '})"><span class="bs ' + o.side + '">' + (o.side === 'B' ? '买' : '卖') + '</span><div class="grow">' + SEC[o.code].name + ' ' + intf(o.qty) + '<div class="muted" style="font-size:11px">' + CAL[o.di] + ' · ' + o.status + '</div></div><div class="n" style="text-align:right;font-size:12px">' + (avg ? '成交 ' + px(o.code, avg) + (op && S.t >= T(9, 25) ? '<div class="muted">偏差 ' + fx((avg / op - 1) * 1e4 * (o.side === 'B' ? 1 : -1), 1) + ' bp</div>' : '') : '未成交') + '</div></div>'; }).join('') + '</div>';
    h += '<div class="sec"><div class="sec-h">书面交易纪律 <small>阶段 8 要求，提前写好</small></div>' + [['add', '加仓条件'], ['pause', '暂停条件'], ['lev', '杠杆']].map(([k, l]) => '<div style="padding:4px 14px 8px"><div class="muted" style="font-size:12px">' + l + '</div><textarea style="width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:13px;resize:vertical" rows="2" onchange="S.rules.' + k + '=this.value">' + esc(S.rules[k]) + '</textarea></div>').join('') + '</div>';
    return h;
  }
};
function genPlanOrders() {
  if (S.orders.some(o => o.src === 'plan' && isLive(o))) return showToast('已经有未执行的预埋单了');
  let n = 0, errs = [];
  for (const pl of S.plan) {
    const a = availableQty(pl.code), d = pl.target - a.held; if (!d) continue;
    const s = SEC[pl.code], p0 = lastPx(pl.code);
    let price = roundTo(p0 * (d > 0 ? 1.02 : 0.98), s.tick);
    price = Math.min(MK[pl.code].up, Math.max(MK[pl.code].down, price));
    const qty = d > 0 ? Math.floor(d / 100) * 100 : Math.min(-d, a.sellable);
    if (!qty) continue;
    const r = placeOrder({ code: pl.code, side: d > 0 ? 'B' : 'S', kind: 'limit', price, qty, preNext: true, src: 'plan' }, true);
    if (r.ok) { r.order.src = 'plan'; n++; } else errs.push(s.name + '：' + r.msg);
  }
  showToast(n ? '已生成 ' + n + ' 笔预埋单，下一交易日 9:15 报送' : '没有需要调整的仓位');
  if (errs.length) ruleError({ rule: '部分委托没有生成', msg: errs.join('\n') });
  refresh();
}
