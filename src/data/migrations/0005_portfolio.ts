export const m0005: string[] = [
  `CREATE TABLE strategy_version (id INTEGER NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id,version))`,
  `CREATE TABLE rebalance (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES account(id), status TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX rebalance_account ON rebalance(account_id,id)`,
  `CREATE TABLE execution_report (rebalance_id INTEGER PRIMARY KEY REFERENCES rebalance(id), account_id INTEGER NOT NULL REFERENCES account(id), week TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE weekly_skip (account_id INTEGER NOT NULL REFERENCES account(id), week TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(account_id,week))`,
  `CREATE TABLE account_event (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES account(id), trade_date TEXT NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX account_event_account ON account_event(account_id,id)`,
  `CREATE TABLE security_day (code TEXT NOT NULL, date TEXT NOT NULL, body TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY(code,date))`,
  `CREATE TABLE data_check (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, date TEXT NOT NULL, body TEXT NOT NULL, checked_at TEXT NOT NULL)`,
];
