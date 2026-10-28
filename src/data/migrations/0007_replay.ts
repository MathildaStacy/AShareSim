/**
 * M6 回放（docs/M6_REPLAY.md）。
 *
 * - engine_input：实时账户每次喂给引擎的输入，按 id 顺序重放就能得到同样的事件。kind = seed 是起点
 *   （当天第一次输入前、或 App 重启时的账户状态）；行情只存引用（code、t、校验值），没进快照库的才存全文。
 * - replay_session：回放练习（沙盒账户），body 是起点设置和你的操作，打开时从头重算。
 */
export const m0007: string[] = [
  `CREATE TABLE engine_input (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES account(id), trade_date TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX engine_input_day ON engine_input(account_id,trade_date,id)`,
  `CREATE TABLE replay_session (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];
