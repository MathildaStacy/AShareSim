/**
 * M4 AI 助手（AI_ASSISTANT.md §4、§5）：对话、消息、长期记忆。和学习进度一样属于用户，不属于某个账户：
 * 重置账户不清（PRODUCT_DESIGN §10）。
 */
export const m0003: string[] = [
  // memory_snapshot：这个对话第一次发送时拍的记忆快照，整个对话都用它（缓存稳定，§5）；压缩时刷新。
  // last_page：最近一次提问时的页面名，换了页面时插「你现在在：xxx」分隔线。
  `CREATE TABLE ai_thread (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    compacted_count INTEGER NOT NULL DEFAULT 0,
    last_page TEXT,
    memory_snapshot TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // 一行一条发给模型的消息：user（提问，带当时附带的上下文）、assistant（模型的一次响应）、
  // tool（这次响应里全部工具调用的结果）。parts 是协议无关的内容，发送时原样转换；
  // raw 是模型返回的原始内容（含推理），同一个服务和模型时原样传回；ui 只给界面用（工具标签、操作卡、
  // 用量、记忆变更），改它不影响发给模型的内容。compacted = 1 的已压缩进摘要，不再发送。
  `CREATE TABLE ai_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES ai_thread (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    raw TEXT,
    ui TEXT,
    compacted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX ai_message_thread ON ai_message (thread_id, id)',

  // 长期记忆：kind 是 background / preference / plan / agreement。删除对话不删记忆（source 只是出处）。
  `CREATE TABLE ai_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    source_thread_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];
