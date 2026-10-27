/**
 * 成交详情的「费用怎么算」和「成交依据」：把一笔成交的每项费用写成代入数字的算式，把依据的结构化字段说成人话。
 * 纯函数，成交详情页和 AI 的页面上下文共用。
 */
import {
  calcFee,
  commissionParams,
  STATUTORY,
  type FeeProfile,
} from '../engine/fees';
import type { Security } from '../engine/securities';
import { formatSec } from '../engine/session';
import type { Fill, FillBasis } from '../engine/types';
import {
  formatFen,
  formatPrice,
  rateToWan,
  type Fen,
  type RateE8,
} from '../engine/units';

export interface FeeLine {
  label: string;
  formula: string;
  /** 金额（分）；null 表示这一项不单独收（例如经手费含在佣金里）。 */
  value: Fen | null;
  /** 补充说明（合并计佣等）。 */
  note?: string;
}

/** 亿分之一的费率 → 百分比文字：50_000 → 0.05%。 */
export function ratePct(rate: RateE8): string {
  return String(rate / 1_000_000) + '%';
}

export function feeLines(
  fill: Fill,
  sec: Pick<Security, 'board'>,
  profile: FeeProfile,
  decimals: 2 | 3,
): FeeLine[] {
  const etf = sec.board === 'etf';
  const amt = formatFen(fill.amount);
  const { rate, minFen } = commissionParams(sec, profile);
  const single = calcFee(sec, fill.side, fill.amount, profile);
  const lines: FeeLine[] = [
    {
      label: '成交金额',
      formula:
        formatPrice(fill.price, decimals) +
        ' × ' +
        fill.qty.toLocaleString('zh-CN'),
      value: fill.amount,
    },
    {
      label: '佣金',
      formula:
        'max(' +
        amt +
        ' × 万 ' +
        rateToWan(rate) +
        ', 最低 ' +
        (minFen / 100).toFixed(2) +
        ' 元)' +
        (etf ? '（ETF 费率）' : ''),
      value: fill.fee.commission,
      note:
        profile.mergeOrder && single.commission !== fill.fee.commission
          ? '同一委托的多笔成交合并计佣：按累计成交额算佣金，再减去前几笔已收的，所以这一笔是 ' +
            formatFen(fill.fee.commission) +
            ' 元，不是单算的 ' +
            formatFen(single.commission) +
            ' 元（最低 5 元整笔委托只收一次）'
          : undefined,
    },
    {
      label: '印花税',
      formula: etf
        ? 'ETF 免征'
        : fill.side === 'B'
        ? '买入不收'
        : amt + ' × ' + ratePct(STATUTORY.stamp),
      value: fill.fee.stamp,
    },
    {
      label: '过户费',
      formula: etf ? 'ETF 免收' : amt + ' × ' + ratePct(STATUTORY.transfer),
      value: fill.fee.transfer,
    },
  ];
  const handlingRate = etf ? STATUTORY.handlingEtf : STATUTORY.handlingStock;
  if (profile.regsSeparate) {
    lines.push(
      {
        label: '经手费',
        formula: amt + ' × ' + ratePct(handlingRate),
        value: fill.fee.handling,
      },
      {
        label: '证管费',
        formula: etf ? 'ETF 免收' : amt + ' × ' + ratePct(STATUTORY.reg),
        value: fill.fee.reg,
      },
    );
  } else {
    lines.push(
      {
        label: '经手费',
        formula: ratePct(handlingRate) + '，已含在佣金里',
        value: null,
      },
      {
        label: '证管费',
        formula: etf ? 'ETF 免收' : ratePct(STATUTORY.reg) + '，已含在佣金里',
        value: null,
      },
    );
  }
  lines.push(
    {
      label: '费用合计',
      formula: '以上各项相加',
      value: fill.fee.total,
    },
    {
      label: fill.side === 'B' ? '资金减少' : '资金增加',
      formula:
        fill.side === 'B'
          ? '成交金额 + 费用 = ' + amt + ' + ' + formatFen(fill.fee.total)
          : '成交金额 − 费用 = ' + amt + ' − ' + formatFen(fill.fee.total),
      value: Math.abs(fill.net),
    },
  );
  return lines;
}

export const BASIS_RULE_NAME: Record<FillBasis['rule'], string> = {
  walk: '主动成交（按盘口逐档吃单）',
  queue: '挂单排队（前面的量消耗完后成交）',
  through: '成交价穿过委托价（这个价位的单子必然都成交了）',
  auction: '集合竞价（按开盘 / 收盘价统一撮合）',
  after: '盘后固定价格交易（按收盘价）',
};

/** 成交依据的结构化字段，有就列出来。 */
export function basisLines(
  b: FillBasis,
  side: 'B' | 'S',
  decimals: 2 | 3,
  unit: string,
): { k: string; v: string }[] {
  const n = (v: number) => v.toLocaleString('zh-CN') + ' ' + unit;
  const out = [
    { k: '依据', v: BASIS_RULE_NAME[b.rule] },
    { k: '快照时间', v: formatSec(b.snapT) },
  ];
  if (b.level != null) {
    out.push({
      k: '档位',
      v: (side === 'B' ? '卖' : '买') + b.level,
    });
  }
  if (b.levelQty != null) {
    out.push({ k: '该档挂单量', v: n(b.levelQty) });
  }
  if (b.queueAhead != null) {
    out.push({ k: '排在前面的量', v: n(b.queueAhead) });
  }
  if (b.volumeDelta != null) {
    out.push({ k: '两次快照间成交量', v: n(b.volumeDelta) });
  }
  if (b.auctionPrice != null) {
    out.push({ k: '竞价价格', v: formatPrice(b.auctionPrice, decimals) });
  }
  if (b.auctionVolume != null) {
    out.push({ k: '竞价成交量', v: n(b.auctionVolume) });
  }
  return out;
}
