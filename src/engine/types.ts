import type { DateStr } from './calendar';
import type { FeeBreakdown, FeeProfile, Side } from './fees';
import type { Sec } from './session';
import type { Fen, Li } from './units';

/** 一档盘口：[价格（厘）, 数量（股 / 份）]。 */
export type Level = [Li, number];

/**
 * 一次行情快照（腾讯接口约 3 秒一次）。数量单位是股 / 份（腾讯给的是手，适配层负责换算）。
 */
export interface Snapshot {
  code: string;
  date: DateStr;
  t: Sec;
  prevClose: Li;
  /** 今日开盘价，开盘前为 null。 */
  open: Li | null;
  /** 最新成交价，当日无成交为 null。 */
  last: Li | null;
  high: Li | null;
  low: Li | null;
  /** 当日累计成交量（股）和成交额（分）。 */
  volume: number;
  amount: Fen;
  /** 买一到买五（价格从高到低）、卖一到卖五（价格从低到高）。 */
  bids: Level[];
  asks: Level[];
  /** 行情给出的涨跌停价；不设涨跌幅时为 null。 */
  up: Li | null;
  down: Li | null;
  /** 停牌。 */
  suspended?: boolean;
}

export type OrderKind =
  | 'limit' // 限价
  | 'b5_ioc' // 最优五档即时成交剩余撤销（沪深）
  | 'b5_limit' // 最优五档即时成交剩余转限价（沪）
  | 'cbest' // 对手方最优价格（深）
  | 'obest' // 本方最优价格（深）
  | 'ioc' // 即时成交剩余撤销（深）
  | 'fok' // 全额成交或撤销（深）
  | 'after'; // 盘后固定价格

export const KIND_NAME: Record<OrderKind, string> = {
  limit: '限价',
  b5_ioc: '最优五档即时成交剩余撤销',
  b5_limit: '最优五档即时成交剩余转限价',
  cbest: '对手方最优价格',
  obest: '本方最优价格',
  ioc: '即时成交剩余撤销',
  fok: '全额成交或撤销',
  after: '盘后固定价格',
};

export type OrderStatus =
  | '未报'
  | '已报'
  | '部成'
  | '已成'
  | '已撤'
  | '部撤'
  | '废单';

/** 委托在哪个环节。 */
export type OrderStage =
  | 'stored' // 券商暂存，等待报送
  | 'auction' // 在集合竞价簿里
  | 'book' // 连续竞价挂单
  | 'after' // 盘后固定价格交易
  | 'done';

export interface Order {
  id: number;
  /** 合同号。 */
  no: string;
  code: string;
  side: Side;
  kind: OrderKind;
  /** 委托价；市价单为 null（转限价后填入）。 */
  price: Li | null;
  qty: number;
  filled: number;
  /** 累计成交金额和费用（合并计佣用）。 */
  amount: Fen;
  fee: FeeBreakdown;
  status: OrderStatus;
  stage: OrderStage;
  /** 在集合竞价簿里时，参加的是开盘还是收盘集合竞价。 */
  auction: 'open' | 'close' | null;
  /** 提交时间。 */
  date: DateStr;
  t: Sec;
  /** 券商暂存的委托报送交易所的日期和时间。 */
  sendDate: DateStr | null;
  sendAt: Sec | null;
  /** 连续竞价的委托是否已经按到达时的盘口处理过（报送时还没有行情的，等第一个快照再处理）。 */
  arrived: boolean;
  /** 估计排在前面的量（股）。 */
  queueAhead: number;
  /** 买入冻结的资金。 */
  frozen: Fen;
  /** 废单 / 撤单原因。 */
  reason: string;
  /** 当前状态说明（例如「排队中，前面约 3,200 股」）。 */
  note: string;
  fills: number[];
}

/** 每笔模拟成交的依据（TRADING_RULES.md §6.3），可以逐笔对账。 */
export interface FillBasis {
  rule: 'walk' | 'queue' | 'through' | 'auction' | 'after';
  /** 依据的快照时间。 */
  snapT: Sec;
  /** 吃单时的档位（1 = 卖一 / 买一）和该档的量。 */
  level?: number;
  levelQty?: number;
  /** 排队时：成交前估计排在前面的量、两次快照间的成交量增量。 */
  queueAhead?: number;
  volumeDelta?: number;
  /** 集合竞价：开盘 / 收盘价、竞价成交量。 */
  auctionPrice?: Li;
  auctionVolume?: number;
  text: string;
}

export interface Fill {
  id: number;
  no: string;
  orderId: number;
  code: string;
  side: Side;
  price: Li;
  qty: number;
  amount: Fen;
  fee: FeeBreakdown;
  /** 资金发生额：买入为负，卖出为正。 */
  net: Fen;
  date: DateStr;
  t: Sec;
  basis: FillBasis;
  /** 卖出时按先进先出算出的待补扣红利税。 */
  divTaxPending?: Fen;
  divTaxNotes?: string[];
}

/** 一批持仓（先进先出算红利税用）。 */
export interface Lot {
  id: number;
  code: string;
  qty: number;
  buyDate: DateStr;
  /** 这批股份持有期间收到的现金红利（分），卖出时按比例结转。 */
  dividend: Fen;
}

/** 每只证券的两种持仓成本口径（TRADING_RULES.md §5）。 */
export interface CostPool {
  /** 摊薄成本池：买入成交额 + 费用 − 卖出净回款 − 现金红利 + 红利税补。 */
  diluted: Fen;
  /** 买入均价成本池（移动加权平均）。 */
  average: Fen;
}

export type LedgerBiz =
  | '证券买入'
  | '证券卖出'
  | '股息入账'
  | '股息红利税补'
  | '红股入账'
  | '银行转证券'
  | '证券转银行';

/** 交割单。 */
export interface LedgerEntry {
  id: number;
  date: DateStr;
  t: Sec;
  biz: LedgerBiz;
  code: string | null;
  price: Li;
  qty: number;
  amount: Fen;
  fee: FeeBreakdown;
  divTax: Fen;
  /** 资金发生额。 */
  net: Fen;
  /** 发生后资金余额。 */
  balance: Fen;
  orderNo: string;
  fillNo: string;
  note: string;
}

export interface PendingDivTax {
  code: string;
  amount: Fen;
  sellDate: DateStr;
  fillId: number;
  notes: string[];
}

/** 除权除息事件（东方财富数据中心）。金额按每股，单位厘，避免每 10 股派 x 元换算误差。 */
export interface CorporateAction {
  code: string;
  /** 股权登记日：这天收盘时的持仓享有权益。 */
  recordDate: DateStr;
  /** 除权除息日。 */
  exDate: DateStr;
  /** 现金红利发放日（沪深 A 股通常就是除息日）。 */
  payDate: DateStr;
  /** 每股派现（税前，厘）。 */
  cashPerShareLi: number;
  /** 每股送转股数（送股 + 转增），例如 10 送 3 转 2 = 0.5。 */
  bonusPerShare: number;
}

export interface AccountState {
  version: 1;
  /** 当前日期和是否已完成日终清算。 */
  date: DateStr;
  settled: boolean;
  cash: Fen;
  frozen: Fen;
  /** 当日卖出净回款：可用不可取，清算后变为可取。 */
  todaySellNet: Fen;
  depositTotal: Fen;
  depositCap: Fen;
  fee: FeeProfile;
  lots: Lot[];
  costs: Record<string, CostPool>;
  orders: Order[];
  fills: Fill[];
  ledger: LedgerEntry[];
  pendingDivTax: PendingDivTax[];
  /** 已处理的除权除息事件（code + exDate）。 */
  appliedActions: string[];
  /** 待到账的现金红利。 */
  pendingDividends: {
    code: string;
    payDate: DateStr;
    amount: Fen;
    action: string;
  }[];
  seq: number;
}

/** 引擎对外的事件，界面层据此弹提示、写操作日志。 */
export type EngineEvent =
  | { type: 'order'; order: Order }
  | { type: 'reject'; order: Order }
  | { type: 'cancel'; order: Order; bySystem: boolean }
  | { type: 'fill'; order: Order; fill: Fill }
  | { type: 'settle'; date: DateStr; canceled: number }
  | { type: 'divTax'; date: DateStr; amount: Fen; code: string }
  | { type: 'dividend'; date: DateStr; amount: Fen; code: string }
  | { type: 'bonus'; date: DateStr; qty: number; code: string }
  | { type: 'warning'; message: string };
