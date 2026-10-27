/**
 * AI 助手的三张表（ai_thread / ai_message / ai_memory）的读写。和 repos.ts 一样只是薄薄一层 SQL，
 * 对话怎么拼、什么时候压缩在 src/ai/ 里。
 */
import type {
  Memory,
  MemoryKind,
  MessageUi,
  Part,
  RawOutput,
  Role,
  StoredMessage,
  Thread,
} from '../ai/types';
import type { Db } from './db';

// ---------- 对话 ----------

interface ThreadRow {
  id: number;
  title: string;
  summary: string;
  compacted_count: number;
  last_page: string | null;
  memory_snapshot: string | null;
  config: string | null;
  last_config: string | null;
  created_at: string;
  updated_at: string;
}

const toThread = (r: ThreadRow): Thread => ({
  id: Number(r.id),
  title: r.title,
  summary: r.summary,
  compactedCount: Number(r.compacted_count),
  lastPage: r.last_page,
  memorySnapshot: r.memory_snapshot,
  config: r.config ? JSON.parse(r.config) : null,
  lastConfig: r.last_config ? JSON.parse(r.last_config) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function createThread(
  db: Db,
  title: string,
  now: string,
): Promise<number> {
  const row = await db.get<{ id: number }>(
    'INSERT INTO ai_thread (title, created_at, updated_at) VALUES (?, ?, ?) RETURNING id',
    [title, now, now],
  );
  return Number(row!.id);
}

export async function thread(db: Db, id: number): Promise<Thread | null> {
  const r = await db.get<ThreadRow>('SELECT * FROM ai_thread WHERE id = ?', [
    id,
  ]);
  return r ? toThread(r) : null;
}

export interface ThreadListItem extends Thread {
  messages: number;
}

/** 对话列表，最近更新的在前；messages 是你的提问和 AI 的回答条数（含已压缩的）。 */
export async function threads(db: Db): Promise<ThreadListItem[]> {
  const rows = await db.all<ThreadRow & { n: number }>(
    `SELECT t.*, (SELECT COUNT(*) FROM ai_message m WHERE m.thread_id = t.id AND m.role = 'user') AS n
     FROM ai_thread t ORDER BY t.updated_at DESC, t.id DESC`,
  );
  return rows.map(r => ({ ...toThread(r), messages: Number(r.n) * 2 }));
}

export async function updateThread(
  db: Db,
  id: number,
  patch: Partial<
    Pick<
      Thread,
      | 'title'
      | 'summary'
      | 'compactedCount'
      | 'lastPage'
      | 'memorySnapshot'
      | 'config'
      | 'lastConfig'
    >
  >,
  now: string,
): Promise<void> {
  const cols: Record<string, string> = {
    title: 'title',
    summary: 'summary',
    compactedCount: 'compacted_count',
    lastPage: 'last_page',
    memorySnapshot: 'memory_snapshot',
    config: 'config',
    lastConfig: 'last_config',
  };
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(cols[k] + ' = ?');
    vals.push(
      (k === 'config' || k === 'lastConfig') && v != null
        ? JSON.stringify(v)
        : (v as string | number | null),
    );
  }
  sets.push('updated_at = ?');
  vals.push(now, id);
  await db.run(`UPDATE ai_thread SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/** 删除对话和它的消息；从它产生的记忆保留（§4）。 */
export async function deleteThread(db: Db, id: number): Promise<void> {
  await db.transaction(async tx => {
    await tx.run('DELETE FROM ai_message WHERE thread_id = ?', [id]);
    await tx.run('DELETE FROM ai_thread WHERE id = ?', [id]);
  });
}

// ---------- 消息 ----------

interface MessageRow {
  id: number;
  thread_id: number;
  role: Role;
  parts: string;
  raw: string | null;
  ui: string | null;
  compacted: number;
  created_at: string;
}

const toMessage = (r: MessageRow): StoredMessage => ({
  id: Number(r.id),
  threadId: Number(r.thread_id),
  role: r.role,
  parts: JSON.parse(r.parts),
  raw: r.raw ? JSON.parse(r.raw) : null,
  ui: r.ui ? JSON.parse(r.ui) : null,
  compacted: !!r.compacted,
  createdAt: r.created_at,
});

export async function addMessage(
  db: Db,
  m: {
    threadId: number;
    role: Role;
    parts: Part[];
    raw?: RawOutput | null;
    ui?: MessageUi | null;
  },
  now: string,
): Promise<number> {
  const row = await db.get<{ id: number }>(
    'INSERT INTO ai_message (thread_id, role, parts, raw, ui, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [
      m.threadId,
      m.role,
      JSON.stringify(m.parts),
      m.raw ? JSON.stringify(m.raw) : null,
      m.ui ? JSON.stringify(m.ui) : null,
      now,
    ],
  );
  await db.run('UPDATE ai_thread SET updated_at = ? WHERE id = ?', [
    now,
    m.threadId,
  ]);
  return Number(row!.id);
}

/** 这个对话的全部消息（含已压缩的），从早到晚。 */
export async function messages(
  db: Db,
  threadId: number,
): Promise<StoredMessage[]> {
  const rows = await db.all<MessageRow>(
    'SELECT * FROM ai_message WHERE thread_id = ? ORDER BY id',
    [threadId],
  );
  return rows.map(toMessage);
}

/** 只改界面数据（操作卡状态、记忆撤销），不碰发给模型的内容。 */
export async function updateMessageUi(
  db: Db,
  id: number,
  ui: MessageUi,
): Promise<void> {
  await db.run('UPDATE ai_message SET ui = ? WHERE id = ?', [
    JSON.stringify(ui),
    id,
  ]);
}

export async function markCompacted(
  db: Db,
  threadId: number,
  upToId: number,
): Promise<void> {
  await db.run(
    'UPDATE ai_message SET compacted = 1 WHERE thread_id = ? AND id <= ?',
    [threadId, upToId],
  );
}

export interface ConversationHit {
  threadId: number;
  title: string;
  summary: string;
  updatedAt: string;
  /** 匹配到的消息片段。 */
  snippets: string[];
}

/** 在对话标题、摘要和消息文字里检索（LIKE；个人数据量很小，§4）。 */
export async function searchConversations(
  db: Db,
  query: string,
  excludeThread: number | null,
  limit = 5,
): Promise<ConversationHit[]> {
  const like = '%' + query.replace(/[%_]/g, '') + '%';
  const rows = await db.all<ThreadRow>(
    `SELECT * FROM ai_thread t WHERE t.id != ? AND (t.title LIKE ? OR t.summary LIKE ? OR EXISTS (
       SELECT 1 FROM ai_message m WHERE m.thread_id = t.id AND m.role IN ('user', 'assistant') AND m.parts LIKE ?))
     ORDER BY t.updated_at DESC LIMIT ?`,
    [excludeThread ?? -1, like, like, like, limit],
  );
  const out: ConversationHit[] = [];
  for (const r of rows) {
    const msgs = await db.all<{ role: Role; parts: string; ui: string | null }>(
      `SELECT role, parts, ui FROM ai_message WHERE thread_id = ? AND role IN ('user', 'assistant') AND parts LIKE ? ORDER BY id LIMIT 3`,
      [r.id, like],
    );
    out.push({
      threadId: Number(r.id),
      title: r.title,
      summary: r.summary,
      updatedAt: r.updated_at,
      snippets: msgs.map(m => {
        // 提问只取问题原文，不带当时附带的页面上下文
        const ui: MessageUi | null = m.ui ? JSON.parse(m.ui) : null;
        const text =
          m.role === 'user' && ui?.question
            ? ui.question
            : (JSON.parse(m.parts) as Part[])
                .map(p => (p.t === 'text' ? p.text : ''))
                .join('');
        const i = Math.max(0, text.indexOf(query));
        return (
          (m.role === 'user' ? '问：' : '答：') +
          text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ')
        );
      }),
    });
  }
  return out;
}

// ---------- 记忆 ----------

interface MemoryRow {
  id: number;
  kind: MemoryKind;
  text: string;
  source_thread_id: number | null;
  created_at: string;
  updated_at: string;
}

const toMemory = (r: MemoryRow): Memory => ({
  id: Number(r.id),
  kind: r.kind,
  text: r.text,
  sourceThreadId:
    r.source_thread_id == null ? null : Number(r.source_thread_id),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function memories(db: Db): Promise<Memory[]> {
  const rows = await db.all<MemoryRow>('SELECT * FROM ai_memory ORDER BY id');
  return rows.map(toMemory);
}

export async function memoryById(db: Db, id: number): Promise<Memory | null> {
  const r = await db.get<MemoryRow>('SELECT * FROM ai_memory WHERE id = ?', [
    id,
  ]);
  return r ? toMemory(r) : null;
}

export async function addMemory(
  db: Db,
  m: { kind: MemoryKind; text: string; sourceThreadId: number | null },
  now: string,
): Promise<number> {
  const row = await db.get<{ id: number }>(
    'INSERT INTO ai_memory (kind, text, source_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [m.kind, m.text, m.sourceThreadId, now, now],
  );
  return Number(row!.id);
}

export async function updateMemory(
  db: Db,
  id: number,
  m: { kind: MemoryKind; text: string },
  now: string,
): Promise<void> {
  await db.run(
    'UPDATE ai_memory SET kind = ?, text = ?, updated_at = ? WHERE id = ?',
    [m.kind, m.text, now, id],
  );
}

/** 撤销「忘记」时用原来的 id 放回去。 */
export async function restoreMemory(db: Db, m: Memory): Promise<void> {
  await db.run(
    'INSERT OR REPLACE INTO ai_memory (id, kind, text, source_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [m.id, m.kind, m.text, m.sourceThreadId, m.createdAt, m.updatedAt],
  );
}

export async function deleteMemory(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM ai_memory WHERE id = ?', [id]);
}

/** 清空操作日志（上下文页，§9）：只清当前没归档的记录，归档账户的随账户保存。 */
export async function clearActivity(db: Db): Promise<void> {
  await db.run(
    'DELETE FROM activity_log WHERE account_id IS NULL OR account_id NOT IN (SELECT id FROM account WHERE archived_at IS NOT NULL)',
  );
}
