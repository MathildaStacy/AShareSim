/** 会话选项和上次发送的选项分开保存，支持发送前改回并保留旧对话。 */
export const m0004: string[] = [
  'ALTER TABLE ai_thread ADD COLUMN config TEXT',
  'ALTER TABLE ai_thread ADD COLUMN last_config TEXT',
];
