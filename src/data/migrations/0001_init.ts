/**
 * M2 的第一版表结构（PRODUCT_DESIGN.md §8）。
 *
 * 账户状态整个存成一行 JSON（`account.state`）：引擎的 AccountState 本来就是纯数据，
 * 拆成委托、成交、批次几张表会有两份数据，容易对不上。委托、成交、交割单都从这行里读。
 */
export const m0001: string[] = [
  `CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // 模拟账户。archived_at 为空的是当前账户；重置账户时旧账户归档，不删除。
  `CREATE TABLE account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  )`,

  // 证券基本信息：板块以腾讯行情的类型字段（GP-A / GP-A-CYB / GP-A-KCB / ETF）为准。
  `CREATE TABLE security (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    pinyin TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE watchlist (
    code TEXT PRIMARY KEY,
    sort INTEGER NOT NULL,
    added_at TEXT NOT NULL
  )`,

  // 每 3 秒的快照（M6 回放用）。价格厘、量股、额分；五档存成「价:量,价:量」。
  `CREATE TABLE quotes_snapshot (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    t INTEGER NOT NULL,
    prev_close INTEGER NOT NULL,
    open INTEGER,
    last INTEGER,
    high INTEGER,
    low INTEGER,
    volume INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    bids TEXT NOT NULL,
    asks TEXT NOT NULL,
    up INTEGER,
    down INTEGER,
    suspended INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (code, date, t)
  ) WITHOUT ROWID`,
  'CREATE INDEX quotes_snapshot_date ON quotes_snapshot (date)',

  // 不复权日线（厘、股、分）。
  `CREATE TABLE kline_day (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    open INTEGER NOT NULL,
    close INTEGER NOT NULL,
    high INTEGER NOT NULL,
    low INTEGER NOT NULL,
    volume INTEGER NOT NULL,
    PRIMARY KEY (code, date)
  ) WITHOUT ROWID`,

  // 除权除息（东方财富数据中心）。
  `CREATE TABLE corp_action (
    code TEXT NOT NULL,
    ex_date TEXT NOT NULL,
    record_date TEXT NOT NULL,
    pay_date TEXT NOT NULL,
    cash_per_share_li REAL NOT NULL,
    bonus_per_share REAL NOT NULL,
    plan TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (code, ex_date)
  ) WITHOUT ROWID`,

  // 交易日历：按年存休市的工作日。confirmed = 0 表示交易所还没公布，工作日暂按交易日处理。
  `CREATE TABLE trade_calendar (
    year INTEGER PRIMARY KEY,
    holidays TEXT NOT NULL,
    confirmed INTEGER NOT NULL,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // 操作日志（AI_ASSISTANT.md §3）。
  `CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    trade_date TEXT NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    ref TEXT
  )`,
  'CREATE INDEX activity_log_ts ON activity_log (ts)',
];
