/**
 * 数据库访问层（做法沿用 NovelCreationPartner）。
 *
 * App 里用 op-sqlite，Jest 测试用 Node 自带的 SQLite（node:sqlite），两者都包成 `Driver`，
 * 上层只看到 `Db`。
 *
 * 所有异步调用共用一个 SQLite 连接，两个操作的语句可能交错进对方的事务里。
 * 所以用一把简单的锁串行化：事务持有锁直到提交或回滚，事务外的单条语句也要等锁。
 */

export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Driver {
  query(
    sql: string,
    params: SqlValue[],
  ): Promise<{ rows: Row[]; changes: number }>;
  close(): Promise<void>;
}

export interface Db {
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** 在一个事务里执行 `fn`。嵌套调用并入外层事务。 */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class Lock {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>(resolve => {
      release = resolve;
    });
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => next);
    return ready;
  }
}

function makeQueryable(
  exec: (
    sql: string,
    params: SqlValue[],
  ) => Promise<{ rows: Row[]; changes: number }>,
  transaction: Db['transaction'],
  close: () => Promise<void>,
): Db {
  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await exec(sql, params)).rows as unknown as T[];
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      return (await exec(sql, params)).rows[0] as unknown as T | undefined;
    },
    async run(sql: string, params: SqlValue[] = []) {
      return { changes: (await exec(sql, params)).changes };
    },
    transaction,
    close,
  };
}

export function createDb(driver: Driver): Db {
  const lock = new Lock();

  const locked = async (sql: string, params: SqlValue[]) => {
    const release = await lock.acquire();
    try {
      return await driver.query(sql, params);
    } finally {
      release();
    }
  };

  const transaction = async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const release = await lock.acquire();
    const tx: Db = makeQueryable(
      (sql, params) => driver.query(sql, params),
      inner => inner(tx),
      async () => {},
    );
    try {
      await driver.query('BEGIN IMMEDIATE', []);
      try {
        const result = await fn(tx);
        await driver.query('COMMIT', []);
        return result;
      } catch (e) {
        await driver.query('ROLLBACK', []);
        throw e;
      }
    } finally {
      release();
    }
  };

  return makeQueryable(locked, transaction, () => driver.close());
}
