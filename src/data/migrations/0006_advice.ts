/**
 * M5.5（AI_ASSISTANT §13.6）：AI 提案和决策日志。整行 JSON 存在 body，常用的筛选列单独存。
 * 记分卡由这两张表算出来，不另存（App 里有最新值的东西不进记忆，也不存第二份）。
 */
export const m0006: string[] = [
  `CREATE TABLE ai_proposal (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES account(id), thread_id INTEGER, status TEXT NOT NULL, due_date TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX ai_proposal_due ON ai_proposal(due_date)`,
  `CREATE TABLE decision_journal (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES account(id), source TEXT NOT NULL, order_id INTEGER, rebalance_id INTEGER, proposal_id INTEGER, code TEXT NOT NULL, due_date TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX decision_journal_account ON decision_journal(account_id,id)`,
];
