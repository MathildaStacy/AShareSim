import { open } from '@op-engineering/op-sqlite';
import { createDb, type Db, type Row, type SqlValue } from '../db';

/** 打开手机上的 App 数据库。 */
export function openDeviceDb(name = 'asharesim.db'): Db {
  const conn = open({ name });
  return createDb({
    async query(sql: string, params: SqlValue[]) {
      const res = await conn.execute(sql, params);
      return {
        rows: (res.rows ?? []) as Row[],
        changes: res.rowsAffected ?? 0,
      };
    },
    async close() {
      conn.close();
    },
  });
}
