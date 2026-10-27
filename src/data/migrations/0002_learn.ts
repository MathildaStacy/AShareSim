/**
 * M3 学习进度（PRODUCT_DESIGN.md §6.4、§8）。学习进度属于用户，不属于某个账户，所以没有 account_id：
 * 重置账户不清学习进度（§10）。
 */
export const m0002: string[] = [
  // 完成项：路线图的练习和通关标准（s0-e1 这种 id）、规则课通过（lesson:fee）、演示完成（demo:auction）。
  // auto = 1 表示由 App 按数据判断的；basis 写判断依据（「2026-10-28 开盘集合竞价买入 沪深300ETF 100 份」）。
  `CREATE TABLE learn_check (
    id TEXT PRIMARY KEY,
    auto INTEGER NOT NULL,
    done_at TEXT NOT NULL,
    basis TEXT NOT NULL DEFAULT ''
  )`,

  // 小测：每道题最后一次的作答。重做一课时删掉这课的作答，已经记下的通过不受影响。
  `CREATE TABLE quiz_answer (
    lesson TEXT NOT NULL,
    q INTEGER NOT NULL,
    choice INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    answered_at TEXT NOT NULL,
    PRIMARY KEY (lesson, q)
  ) WITHOUT ROWID`,
];
