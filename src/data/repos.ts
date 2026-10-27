/**
 * 各张表的读写。都是薄薄一层 SQL，业务逻辑在 sim/ 里。
 */
import { upgradeState } from '../engine/account';
import { HOLIDAYS, type DateStr } from '../engine/calendar';
import type {
  AccountState,
  CorporateAction,
  Level,
  Snapshot,
} from '../engine/types';
import type { Db } from './db';

// ---------- 设置 ----------

export async function getSetting<T>(
  db: Db,
  key: string,
  fallback: T,
): Promise<T> {
  const row = await db.get<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  if (!row) {
    return fallback;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(
  db: Db,
  key: string,
  value: unknown,
): Promise<void> {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}

// ---------- 账户 ----------

export interface AccountRow {
  id: number;
  name: string;
  state: AccountState;
  createdAt: string;
  /** 归档时间；当前账户为 null。 */
  archivedAt?: string | null;
}

interface AccountDbRow {
  id: number;
  name: string;
  state: string;
  created_at: string;
  archived_at: string | null;
}

const toAccount = (row: AccountDbRow): AccountRow => ({
  id: Number(row.id),
  name: row.name,
  state: upgradeState(JSON.parse(row.state) as AccountState),
  createdAt: row.created_at,
  archivedAt: row.archived_at,
});

export async function currentAccount(db: Db): Promise<AccountRow | null> {
  const row = await db.get<AccountDbRow>(
    'SELECT id, name, state, created_at, archived_at FROM account WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1',
  );
  return row ? toAccount(row) : null;
}

/** 全部账户（当前的和已归档的），新的在前。 */
export async function allAccounts(db: Db): Promise<AccountRow[]> {
  const rows = await db.all<AccountDbRow>(
    'SELECT id, name, state, created_at, archived_at FROM account ORDER BY id DESC',
  );
  return rows.map(toAccount);
}

export async function accountById(
  db: Db,
  id: number,
): Promise<AccountRow | null> {
  const row = await db.get<AccountDbRow>(
    'SELECT id, name, state, created_at, archived_at FROM account WHERE id = ?',
    [id],
  );
  return row ? toAccount(row) : null;
}

export async function createAccount(
  db: Db,
  name: string,
  state: AccountState,
  now: string,
): Promise<number> {
  await db.run(
    'INSERT INTO account (name, state, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [name, JSON.stringify(state), now, now],
  );
  const row = await db.get<{ id: number }>('SELECT last_insert_rowid() AS id');
  return Number(row!.id);
}

export async function saveAccountState(
  db: Db,
  id: number,
  state: AccountState,
  now: string,
): Promise<void> {
  await db.run('UPDATE account SET state = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(state),
    now,
    id,
  ]);
}

/** 重置账户：旧账户归档（可以查看、导出），不删除。 */
export async function archiveAccount(
  db: Db,
  id: number,
  now: string,
): Promise<void> {
  await db.run('UPDATE account SET archived_at = ? WHERE id = ?', [now, id]);
}

// ---------- 证券 ----------

export interface SecurityRow {
  code: string;
  name: string;
  type: string;
  pinyin: string;
}

export async function upsertSecurity(
  db: Db,
  s: SecurityRow,
  now: string,
): Promise<void> {
  await db.run(
    `INSERT INTO security (code, name, type, pinyin, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, type = excluded.type,
       pinyin = CASE WHEN excluded.pinyin = '' THEN security.pinyin ELSE excluded.pinyin END,
       updated_at = excluded.updated_at`,
    [s.code, s.name, s.type, s.pinyin, now],
  );
}

export async function allSecurities(db: Db): Promise<SecurityRow[]> {
  return db.all<SecurityRow>('SELECT code, name, type, pinyin FROM security');
}

// ---------- 自选 ----------

export async function watchlist(db: Db): Promise<string[]> {
  const rows = await db.all<{ code: string }>(
    'SELECT code FROM watchlist ORDER BY sort, added_at',
  );
  return rows.map(r => r.code);
}

export async function addWatch(
  db: Db,
  code: string,
  now: string,
): Promise<void> {
  await db.run(
    'INSERT OR IGNORE INTO watchlist (code, sort, added_at) VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM watchlist), ?)',
    [code, now],
  );
}

export async function removeWatch(db: Db, code: string): Promise<void> {
  await db.run('DELETE FROM watchlist WHERE code = ?', [code]);
}

export async function reorderWatchlist(db: Db, codes: string[]): Promise<void> {
  await db.transaction(async tx => {
    for (let i = 0; i < codes.length; i++) {
      await tx.run('UPDATE watchlist SET sort = ? WHERE code = ?', [
        i + 1,
        codes[i],
      ]);
    }
  });
}

// ---------- 快照 ----------

const encodeLevels = (ls: Level[]) => ls.map(([p, q]) => p + ':' + q).join(',');

const decodeLevels = (s: string): Level[] =>
  s
    ? s.split(',').map(x => {
        const [p, q] = x.split(':');
        return [Number(p), Number(q)] as Level;
      })
    : [];

/** 存实时快照；同秒的有效修正覆盖旧值，完全重复的数据由接入层过滤。补出来的快照不存。 */
export async function saveSnapshot(db: Db, s: Snapshot): Promise<boolean> {
  if (s.reconstructed) {
    return false;
  }
  const r = await db.run(
    `INSERT INTO quotes_snapshot
      (code, date, t, prev_close, open, last, high, low, volume, amount, bids, asks, up, down, suspended)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code,date,t) DO UPDATE SET
       prev_close=excluded.prev_close,open=excluded.open,last=excluded.last,
       high=excluded.high,low=excluded.low,volume=excluded.volume,amount=excluded.amount,
       bids=excluded.bids,asks=excluded.asks,up=excluded.up,down=excluded.down,suspended=excluded.suspended`,
    [
      s.code,
      s.date,
      s.t,
      s.prevClose,
      s.open,
      s.last,
      s.high,
      s.low,
      s.volume,
      s.amount,
      encodeLevels(s.bids),
      encodeLevels(s.asks),
      s.up,
      s.down,
      s.suspended ? 1 : 0,
    ],
  );
  return r.changes > 0;
}

interface SnapshotDbRow {
  code: string;
  date: string;
  t: number;
  prev_close: number;
  open: number | null;
  last: number | null;
  high: number | null;
  low: number | null;
  volume: number;
  amount: number;
  bids: string;
  asks: string;
  up: number | null;
  down: number | null;
  suspended: number;
}

function toSnapshot(r: SnapshotDbRow): Snapshot {
  const s: Snapshot = {
    code: r.code,
    date: r.date,
    t: Number(r.t),
    prevClose: Number(r.prev_close),
    open: r.open,
    last: r.last,
    high: r.high,
    low: r.low,
    volume: Number(r.volume),
    amount: Number(r.amount),
    bids: decodeLevels(r.bids),
    asks: decodeLevels(r.asks),
    up: r.up,
    down: r.down,
  };
  if (r.suspended) {
    s.suspended = true;
  }
  return s;
}

/** 某只证券某天最后一个存下来的快照（重启后给引擎做比较基准、给补撮合定起点）。 */
export async function lastSnapshot(
  db: Db,
  code: string,
  date: DateStr,
): Promise<Snapshot | null> {
  const r = await db.get<SnapshotDbRow>(
    'SELECT * FROM quotes_snapshot WHERE code = ? AND date = ? ORDER BY t DESC LIMIT 1',
    [code, date],
  );
  return r ? toSnapshot(r) : null;
}

/** 重启后的报价水位，防止接口旧缓存覆盖更晚的本地快照。 */
export async function latestSnapshot(
  db: Db,
  code: string,
): Promise<Snapshot | null> {
  const r = await db.get<SnapshotDbRow>(
    'SELECT * FROM quotes_snapshot WHERE code = ? ORDER BY date DESC,t DESC LIMIT 1',
    [code],
  );
  return r ? toSnapshot(r) : null;
}

export async function snapshotsOf(
  db: Db,
  code: string,
  date: DateStr,
): Promise<Snapshot[]> {
  const rows = await db.all<SnapshotDbRow>(
    'SELECT * FROM quotes_snapshot WHERE code = ? AND date = ? ORDER BY t',
    [code, date],
  );
  return rows.map(toSnapshot);
}

/** 只保留最近 keepDays 个有快照的日期；0 表示永久保留。 */
export async function pruneSnapshots(
  db: Db,
  keepDays: number,
): Promise<number> {
  if (keepDays <= 0) {
    return 0;
  }
  const dates = await db.all<{ date: string }>(
    'SELECT DISTINCT date FROM quotes_snapshot ORDER BY date DESC',
  );
  if (dates.length <= keepDays) {
    return 0;
  }
  const cutoff = dates[keepDays - 1].date;
  const r = await db.run('DELETE FROM quotes_snapshot WHERE date < ?', [
    cutoff,
  ]);
  return r.changes;
}

export async function snapshotStats(
  db: Db,
): Promise<{ rows: number; days: number; codes: number }> {
  const r = await db.get<{ rows: number; days: number; codes: number }>(
    'SELECT COUNT(*) AS rows, COUNT(DISTINCT date) AS days, COUNT(DISTINCT code) AS codes FROM quotes_snapshot',
  );
  return {
    rows: Number(r?.rows ?? 0),
    days: Number(r?.days ?? 0),
    codes: Number(r?.codes ?? 0),
  };
}

// ---------- 除权除息 ----------

export async function saveCorporateActions(
  db: Db,
  rows: (CorporateAction & { plan: string })[],
  now: string,
): Promise<void> {
  await db.transaction(async tx => {
    for (const a of rows) {
      await tx.run(
        `INSERT INTO corp_action (code, ex_date, record_date, pay_date, cash_per_share_li, bonus_per_share, plan, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code, ex_date) DO UPDATE SET record_date = excluded.record_date, pay_date = excluded.pay_date,
           cash_per_share_li = excluded.cash_per_share_li, bonus_per_share = excluded.bonus_per_share,
           plan = excluded.plan, fetched_at = excluded.fetched_at`,
        [
          a.code,
          a.exDate,
          a.recordDate,
          a.payDate,
          a.cashPerShareLi,
          a.bonusPerShare,
          a.plan,
          now,
        ],
      );
    }
  });
}

export async function corporateActions(db: Db): Promise<CorporateAction[]> {
  const rows = await db.all<{
    code: string;
    ex_date: string;
    record_date: string;
    pay_date: string;
    cash_per_share_li: number;
    bonus_per_share: number;
  }>('SELECT * FROM corp_action ORDER BY ex_date');
  return rows.map(r => ({
    code: r.code,
    exDate: r.ex_date,
    recordDate: r.record_date,
    payDate: r.pay_date,
    cashPerShareLi: Number(r.cash_per_share_li),
    bonusPerShare: Number(r.bonus_per_share),
  }));
}

// ---------- 交易日历 ----------

export interface CalendarYear {
  year: number;
  holidays: DateStr[];
  /** 交易所已公布休市安排。 */
  confirmed: boolean;
  source: string;
}

/** 第一次启动时用引擎内置的休市日建表：2026 年已确认（由真实日 K 线反推），2027 年等交易所公布。 */
export async function seedCalendar(db: Db, now: string): Promise<void> {
  const byYear = new Map<number, DateStr[]>();
  for (const d of HOLIDAYS) {
    const y = Number(d.slice(0, 4));
    byYear.set(y, [...(byYear.get(y) ?? []), d]);
  }
  for (const [year, holidays] of byYear) {
    await db.run(
      'INSERT OR IGNORE INTO trade_calendar (year, holidays, confirmed, source, updated_at) VALUES (?, ?, ?, ?, ?)',
      [
        year,
        JSON.stringify(holidays),
        year <= 2026 ? 1 : 0,
        year <= 2026
          ? '真实日 K 线反推'
          : '交易所尚未公布，元旦先按 1 月 1 日休市',
        now,
      ],
    );
  }
}

export async function calendarYears(db: Db): Promise<CalendarYear[]> {
  const rows = await db.all<{
    year: number;
    holidays: string;
    confirmed: number;
    source: string;
  }>(
    'SELECT year, holidays, confirmed, source FROM trade_calendar ORDER BY year',
  );
  return rows.map(r => ({
    year: Number(r.year),
    holidays: JSON.parse(r.holidays) as DateStr[],
    confirmed: Number(r.confirmed) === 1,
    source: r.source,
  }));
}

export async function saveCalendarYear(
  db: Db,
  y: CalendarYear,
  now: string,
): Promise<void> {
  await db.run(
    `INSERT INTO trade_calendar (year, holidays, confirmed, source, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(year) DO UPDATE SET holidays = excluded.holidays, confirmed = excluded.confirmed,
       source = excluded.source, updated_at = excluded.updated_at`,
    [y.year, JSON.stringify(y.holidays), y.confirmed ? 1 : 0, y.source, now],
  );
}

// ---------- 操作日志 ----------

export type ActivityKind =
  | 'view'
  | 'order'
  | 'reject'
  | 'cancel'
  | 'fill'
  | 'transfer'
  | 'setting'
  | 'learn'
  | 'export'
  | 'system'
  | 'ai';

export interface Activity {
  id?: number;
  accountId: number | null;
  tradeDate: DateStr;
  ts: string;
  kind: ActivityKind;
  text: string;
  ref?: Record<string, unknown> | null;
}

export async function logActivity(db: Db, a: Activity): Promise<void> {
  await db.run(
    'INSERT INTO activity_log (account_id, trade_date, ts, kind, text, ref) VALUES (?, ?, ?, ?, ?, ?)',
    [
      a.accountId,
      a.tradeDate,
      a.ts,
      a.kind,
      a.text,
      a.ref ? JSON.stringify(a.ref) : null,
    ],
  );
}

interface ActivityDbRow {
  id: number;
  account_id: number | null;
  trade_date: string;
  ts: string;
  kind: ActivityKind;
  text: string;
  ref: string | null;
}

const toActivity = (r: ActivityDbRow): Activity => ({
  id: Number(r.id),
  accountId: r.account_id == null ? null : Number(r.account_id),
  tradeDate: r.trade_date,
  ts: r.ts,
  kind: r.kind,
  text: r.text,
  ref: r.ref ? JSON.parse(r.ref) : null,
});

/**
 * 最近 n 条操作，从新到旧。给了 accountId 时只要这个账户的（和不属于任何账户的）记录：
 * 重置账户后，AI 的「最近操作」只带当前账户的（PRODUCT_DESIGN §10）。
 */
export async function recentActivity(
  db: Db,
  n: number,
  accountId?: number,
): Promise<Activity[]> {
  const rows =
    accountId == null
      ? await db.all<ActivityDbRow>(
          'SELECT * FROM activity_log ORDER BY id DESC LIMIT ?',
          [n],
        )
      : await db.all<ActivityDbRow>(
          'SELECT * FROM activity_log WHERE account_id = ? OR account_id IS NULL ORDER BY id DESC LIMIT ?',
          [accountId, n],
        );
  return rows.map(toActivity);
}

/** 某个账户自己的操作日志（历史账户详情页），从新到旧。 */
export async function activityOf(
  db: Db,
  accountId: number,
  n: number,
): Promise<Activity[]> {
  const rows = await db.all<ActivityDbRow>(
    'SELECT * FROM activity_log WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    [accountId, n],
  );
  return rows.map(toActivity);
}

/**
 * 保留最近 500 条，且不超过 90 天（AI_ASSISTANT.md §3）。归档账户的操作日志随账户保存，不参与清理。
 */
export async function pruneActivity(db: Db, oldestTs: string): Promise<void> {
  const live =
    '(account_id IS NULL OR account_id NOT IN (SELECT id FROM account WHERE archived_at IS NOT NULL))';
  await db.run(
    `DELETE FROM activity_log WHERE ${live} AND (ts < ? OR id <= (SELECT id FROM activity_log WHERE ${live} ORDER BY id DESC LIMIT 1 OFFSET 500))`,
    [oldestTs],
  );
}

// ---------- 学习进度（M3） ----------

export interface LearnCheck {
  id: string;
  auto: boolean;
  doneAt: string;
  basis: string;
}

export async function learnChecks(db: Db): Promise<LearnCheck[]> {
  const rows = await db.all<{
    id: string;
    auto: number;
    done_at: string;
    basis: string;
  }>('SELECT id, auto, done_at, basis FROM learn_check');
  return rows.map(r => ({
    id: r.id,
    auto: Number(r.auto) === 1,
    doneAt: r.done_at,
    basis: r.basis,
  }));
}

/** 记一个完成项；已经有了就不改（第一次完成的日期和依据保留）。返回是否新记的。 */
export async function addLearnCheck(db: Db, c: LearnCheck): Promise<boolean> {
  const r = await db.run(
    'INSERT OR IGNORE INTO learn_check (id, auto, done_at, basis) VALUES (?, ?, ?, ?)',
    [c.id, c.auto ? 1 : 0, c.doneAt, c.basis],
  );
  return r.changes > 0;
}

/** 取消一个手动勾选的项（自动项不能手动取消）。 */
export async function removeLearnCheck(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM learn_check WHERE id = ? AND auto = 0', [id]);
}

export interface QuizAnswer {
  lesson: string;
  q: number;
  choice: number;
  correct: boolean;
  answeredAt: string;
}

export async function quizAnswers(db: Db): Promise<QuizAnswer[]> {
  const rows = await db.all<{
    lesson: string;
    q: number;
    choice: number;
    correct: number;
    answered_at: string;
  }>('SELECT lesson, q, choice, correct, answered_at FROM quiz_answer');
  return rows.map(r => ({
    lesson: r.lesson,
    q: Number(r.q),
    choice: Number(r.choice),
    correct: Number(r.correct) === 1,
    answeredAt: r.answered_at,
  }));
}

export async function saveQuizAnswer(db: Db, a: QuizAnswer): Promise<void> {
  await db.run(
    `INSERT INTO quiz_answer (lesson, q, choice, correct, answered_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lesson, q) DO UPDATE SET choice = excluded.choice, correct = excluded.correct,
       answered_at = excluded.answered_at`,
    [a.lesson, a.q, a.choice, a.correct ? 1 : 0, a.answeredAt],
  );
}

export async function clearQuiz(db: Db, lesson: string): Promise<void> {
  await db.run('DELETE FROM quiz_answer WHERE lesson = ?', [lesson]);
}

/** 某个页面最近一次被浏览的时间（判断「成交之后有没有打开过交割单」用）。 */
export async function lastViewOf(
  db: Db,
  page: string,
): Promise<string | null> {
  const row = await db.get<{ ts: string }>(
    "SELECT ts FROM activity_log WHERE kind = 'view' AND ref = ? ORDER BY id DESC LIMIT 1",
    [JSON.stringify({ page })],
  );
  return row?.ts ?? null;
}
