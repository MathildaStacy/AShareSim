import type { Db } from '../db';
import { m0001 } from './0001_init';
import { m0002 } from './0002_learn';
import { m0003 } from './0003_ai';
import { m0004 } from './0004_ai_options';
import { m0005 } from './0005_portfolio';

/** 按顺序排列；下标 + 1 就是存在 PRAGMA user_version 里的版本号。 */
export const migrations: string[][] = [m0001, m0002, m0003, m0004, m0005];

export const SCHEMA_VERSION = migrations.length;

/** 把数据库升级到 SCHEMA_VERSION。每个迁移和版本号在同一个事务里，失败时停在上一个版本。 */
export async function migrate(db: Db): Promise<{ from: number; to: number }> {
  await db.run('PRAGMA foreign_keys = ON');
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const from = Number(row?.user_version ?? 0);
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `数据库版本 ${from} 比这个 App 支持的版本（${SCHEMA_VERSION}）新`,
    );
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    await db.transaction(async tx => {
      for (const sql of migrations[v]) {
        await tx.run(sql);
      }
      await tx.run(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return { from, to: SCHEMA_VERSION };
}
