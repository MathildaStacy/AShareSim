import type { Db } from '../data/db';
import { beijingIso } from '../market/clock';
import type { JournalEntry, Proposal } from './types';

type NewProposal = Omit<Proposal, 'id'>;

export async function addProposal(db: Db, p: NewProposal): Promise<Proposal> {
  return db.transaction(async tx => {
    await tx.run(
      'INSERT INTO ai_proposal(account_id,thread_id,status,due_date,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      [
        p.accountId,
        p.threadId,
        p.status,
        p.dueDate,
        '{}',
        p.createdAt,
        p.createdAt,
      ],
    );
    const id = Number(
      (await tx.get<{ id: number }>('SELECT last_insert_rowid() AS id'))!.id,
    );
    const out = { ...p, id };
    await saveProposal(tx, out);
    return out;
  });
}

export async function saveProposal(db: Db, p: Proposal): Promise<void> {
  await db.run(
    'UPDATE ai_proposal SET status=?,due_date=?,body=?,updated_at=? WHERE id=?',
    [p.status, p.dueDate, JSON.stringify(p), beijingIso(), p.id],
  );
}

export async function proposals(db: Db, limit = 200): Promise<Proposal[]> {
  return (
    await db.all<{ body: string }>(
      'SELECT body FROM ai_proposal ORDER BY id DESC LIMIT ?',
      [limit],
    )
  ).map(r => JSON.parse(r.body));
}

export async function proposalById(
  db: Db,
  id: number,
): Promise<Proposal | null> {
  const r = await db.get<{ body: string }>(
    'SELECT body FROM ai_proposal WHERE id=?',
    [id],
  );
  return r ? JSON.parse(r.body) : null;
}

export async function addJournal(
  db: Db,
  e: Omit<JournalEntry, 'id'>,
): Promise<JournalEntry> {
  return db.transaction(async tx => {
    await tx.run(
      'INSERT INTO decision_journal(account_id,source,order_id,rebalance_id,proposal_id,code,due_date,body,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        e.accountId,
        e.source,
        e.orderId,
        e.rebalanceId,
        e.proposalId,
        e.code,
        e.dueDate,
        '{}',
        e.createdAt,
      ],
    );
    const id = Number(
      (await tx.get<{ id: number }>('SELECT last_insert_rowid() AS id'))!.id,
    );
    const out = { ...e, id };
    await saveJournal(tx, out);
    return out;
  });
}

export async function saveJournal(db: Db, e: JournalEntry): Promise<void> {
  await db.run('UPDATE decision_journal SET body=? WHERE id=?', [
    JSON.stringify(e),
    e.id,
  ]);
}

export async function journal(
  db: Db,
  opts: { accountId?: number; code?: string; limit?: number } = {},
): Promise<JournalEntry[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.accountId != null) {
    where.push('account_id=?');
    params.push(opts.accountId);
  }
  if (opts.code) {
    where.push('code=?');
    params.push(opts.code);
  }
  params.push(opts.limit ?? 200);
  return (
    await db.all<{ body: string }>(
      'SELECT body FROM decision_journal' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ' ORDER BY id DESC LIMIT ?',
      params,
    )
  ).map(r => JSON.parse(r.body));
}

export async function journalOfOrder(
  db: Db,
  orderId: number,
  accountId: number,
): Promise<JournalEntry | null> {
  const r = await db.get<{ body: string }>(
    'SELECT body FROM decision_journal WHERE order_id=? AND account_id=?',
    [orderId, accountId],
  );
  return r ? JSON.parse(r.body) : null;
}
