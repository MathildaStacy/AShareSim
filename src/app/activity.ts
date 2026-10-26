/**
 * 界面层的操作日志：浏览（view）和自选增删（setting）。引擎那一层的委托、成交等由 Simulator 记。
 * 连续停留在同一个页面只记一次浏览（AI_ASSISTANT.md §3）。
 */
import type { Activity } from '../data/repos';

export type ActivityWriter = (
  a: Pick<Activity, 'kind' | 'text' | 'ref'>,
) => Promise<void>;

export class ViewLogger {
  private last: string | null = null;

  constructor(private write: ActivityWriter) {}

  /** key 标识页面（例如 stock:sh600036），和上一次浏览的页面相同就不记。返回是否记了。 */
  async view(key: string, text: string): Promise<boolean> {
    if (key === this.last) {
      return false;
    }
    this.last = key;
    await this.write({ kind: 'view', text, ref: { page: key } });
    return true;
  }

  async setting(text: string, ref: Record<string, unknown> | null = null) {
    await this.write({ kind: 'setting', text, ref });
  }
}
