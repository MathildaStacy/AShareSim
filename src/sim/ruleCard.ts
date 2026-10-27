/**
 * 个股详情的「本股规则卡」（PRODUCT_DESIGN §6.1）：这只证券现在适用哪些规则。
 * 纯函数，规则卡和 AI 的页面上下文用同一份文字。规则本身都来自引擎，这里只负责说成人话。
 */
import type { Holding } from '../engine/account';
import type { FeeProfile } from '../engine/fees';
import { ruleOf, type Board, type Security } from '../engine/securities';
import {
  AFTER_END,
  PHASES,
  phaseAt,
  storedSendTime,
  type Phase,
  type Sec,
} from '../engine/session';
import type { Snapshot } from '../engine/types';
import { formatPrice } from '../engine/units';
import { cageRange } from '../engine/validate';
import { feeLabel } from './feeForm';

export const BOARD_NAME: Record<Board, string> = {
  main: '主板',
  cyb: '创业板',
  kcb: '科创板',
  etf: 'ETF',
};

export interface RuleItem {
  k: string;
  v: string;
  /** true 显示 ✓，false 显示 ✕，不填不显示。 */
  ok?: boolean;
}

export interface RuleCardInput {
  sec: Security;
  snap: Snapshot | null;
  t: Sec;
  isTradingDay: boolean;
  holding: Holding;
  fee: FeeProfile;
}

const PHASE_RANGE: Partial<Record<Phase, string>> = {
  auc1: '9:15–9:20',
  auc2: '9:20–9:25',
  wait: '9:25–9:30',
  cont: '9:30–11:30、13:00–14:57',
  lunch: '11:30–13:00',
  cauc: '14:57–15:00',
  closed1: '15:00–15:05',
  after: '15:05–15:30',
};

const hm = (t: Sec) =>
  Math.floor(t / 3600) +
  ':' +
  String(Math.floor((t % 3600) / 60)).padStart(2, '0');

/** 「现在」这一行：处在哪个时段、委托怎么走、能不能撤单。 */
export function nowRule(
  t: Sec,
  isTradingDay: boolean,
): { text: string; canCancel: boolean } {
  if (!isTradingDay) {
    return {
      text: '休市（非交易日）：现在下的是预埋单，下一交易日 9:15 报送交易所；可以撤单',
      canCancel: true,
    };
  }
  const phase = phaseAt(t);
  const p = PHASES[phase];
  const range = PHASE_RANGE[phase];
  let text = p.name + (range ? '（' + range + '）' : '') + '：';
  if (p.route === 'store') {
    text += '委托由券商暂存，' + hm(storedSendTime(phase)!) + ' 报送交易所';
  } else if (p.route === 'auction') {
    text +=
      phase === 'cauc'
        ? '只接受限价单，进入收盘集合竞价'
        : '委托进入开盘集合竞价';
  } else if (p.route === 'continuous') {
    text += '委托直接报交易所';
  } else {
    text += '普通委托算下一交易日的预埋单';
    if (t < AFTER_END) {
      text += '；盘后固定价格交易 15:30 前还能申报';
    }
  }
  text += p.exchangeCancel
    ? '；可以撤单'
    : '；已报交易所的委托不能撤单（券商暂存的可以撤）';
  return { text, canCancel: p.exchangeCancel };
}

/** 涨跌幅：以行情给出的涨跌停价为准（ETF 的涨跌幅取决于跟踪的指数），没有时按板块默认值。 */
export function limitPct(sec: Security, snap: Snapshot | null): number | null {
  if (sec.noPriceLimit) {
    return null;
  }
  if (snap?.up != null && snap.prevClose > 0) {
    return Math.round(((snap.up - snap.prevClose) / snap.prevClose) * 100);
  }
  return ruleOf(sec).defaultLimitPct;
}

export function ruleCard(input: RuleCardInput): RuleItem[] {
  const { sec, snap, t, isTradingDay, holding: h, fee } = input;
  const rule = ruleOf(sec);
  const d = rule.decimals;
  const p = (v: number) => formatPrice(v, d);
  const unit = sec.board === 'etf' ? '份' : '股';
  const out: RuleItem[] = [];

  const pct = limitPct(sec, snap);
  out.push({
    k: '板块',
    v:
      (sec.exchange === 'SH' ? '沪市' : '深市') +
      BOARD_NAME[sec.board] +
      (sec.st ? '·风险警示（ST）' : '') +
      '，' +
      (pct == null ? '不设涨跌幅' : '涨跌幅 ±' + pct + '%') +
      (sec.st ? '（2026-07-06 起主板 ST 由 ±5% 调为 ±10%）' : '') +
      (sec.board === 'etf'
        ? '（取决于跟踪的指数，以交易所给的涨跌停价为准）'
        : ''),
  });
  if (snap?.up != null && snap.down != null) {
    out.push({
      k: '今日价格区间',
      v: '跌停 ' + p(snap.down) + ' ～ 涨停 ' + p(snap.up),
    });
  }
  out.push({
    k: '申报单位',
    v:
      rule.buyStep === 1
        ? '买入至少 ' +
          rule.buyMin +
          ' 股，超过部分 1 股递增；卖出不足 ' +
          rule.sellMin +
          ' 股时一次卖完'
        : '买入 ' +
          rule.buyMin +
          ' ' +
          unit +
          '（1 手）的整数倍；不足 100 ' +
          unit +
          '的零股只能一次卖出',
  });
  out.push({
    k: '最小价位',
    v: (rule.tickLi / 1000).toFixed(d) + ' 元',
  });
  out.push({
    k: '单笔上限',
    v:
      rule.maxLimitQty == null
        ? '⚠️ 待核实，暂不校验'
        : rule.maxMarketQty === rule.maxLimitQty
        ? (rule.maxLimitQty / 10_000).toLocaleString('zh-CN') +
          ' 万' +
          unit +
          '，限价市价一样'
        : '限价 ' +
          (rule.maxLimitQty / 10_000).toLocaleString('zh-CN') +
          ' 万' +
          unit +
          '，市价 ' +
          ((rule.maxMarketQty ?? 0) / 10_000).toLocaleString('zh-CN') +
          ' 万' +
          unit,
  });

  // 价格笼子
  let cage: string;
  if (!rule.cage.enabled) {
    cage = 'ETF 不适用价格笼子，只受涨跌幅限制';
  } else {
    const how =
      rule.cage.ticks > 0
        ? '买入价 ≤ 卖一 × 102% 和卖一 + 10 个价位中较高的，卖出价 ≥ 买一 × 98% 和买一 − 10 个价位中较低的'
        : '买入价 ≤ 卖一 × 102%，卖出价 ≥ 买一 × 98%（科创板没有 10 个价位的兜底）';
    if (isTradingDay && phaseAt(t) === 'cont' && snap) {
      const b = cageRange(sec, 'B', snap);
      const s = cageRange(sec, 'S', snap);
      cage =
        '现在买入价 ≤ ' +
        p(b!.max!) +
        '（基准 ' +
        p(b!.base) +
        '），卖出价 ≥ ' +
        p(s!.min!) +
        '（基准 ' +
        p(s!.base) +
        '）。超出的是废单';
    } else {
      cage = '只在连续竞价阶段生效：' + how;
    }
  }
  out.push({ k: '价格笼子', v: cage });

  const now = nowRule(t, isTradingDay);
  out.push({ k: '现在', v: now.text, ok: now.canCancel });

  // 可卖数量和原因
  if (h.held === 0) {
    out.push({ k: '可卖', v: '没有持仓，不能卖出', ok: false });
  } else {
    const why: string[] = [];
    if (h.todayBuy > 0) {
      why.push(
        '今日买入 ' + h.todayBuy + ' ' + unit + '下一交易日才能卖（T+1）',
      );
    }
    if (h.frozenSell > 0) {
      why.push('已有卖单冻结 ' + h.frozenSell + ' ' + unit);
    }
    out.push({
      k: '可卖',
      v:
        '持有 ' +
        h.held +
        ' ' +
        unit +
        '，可卖 ' +
        h.sellable +
        ' ' +
        unit +
        (why.length ? '：' + why.join('；') : ''),
      ok: h.sellable > 0,
    });
  }
  out.push({
    k: 'T+1',
    v:
      sec.board === 'etf'
        ? '今天买入的下一交易日才能卖。V1 所有 ETF 都按 T+1；跨境、债券、黄金、货币 ETF 实盘是 T+0（⚠️ 待支持，模拟更保守）'
        : '今天买入的下一交易日才能卖；卖出的钱当天可用，下一交易日可取',
  });

  const etf = sec.board === 'etf';
  out.push({
    k: '交易费用',
    v:
      feeLabel(fee, sec.board) +
      (etf
        ? '；ETF 免印花税、过户费'
        : '；过户费 0.001%（双向）；印花税 0.05%（仅卖出）'),
  });
  return out;
}
