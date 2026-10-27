/**
 * 学习模块（M3）的数据结构：规则课的内容块、小测、「去实践」的去处。
 * 内容是纯数据，界面按块渲染（不用 HTML），AI 的页面上下文和 get_rule 工具也读同一份。
 */

/** 一段文字里的加粗：用 **…** 标出，渲染时拆开。 */
export type Inline = string;

export type LessonBlock =
  | { t: 'p'; text: Inline }
  | { t: 'h'; text: string }
  | { t: 'list'; items: Inline[] }
  /** 表格：第一行是表头。 */
  | { t: 'table'; rows: string[][] }
  /** 例子（浅色底的框）。 */
  | { t: 'eg'; text: Inline }
  /** 提醒（橙色底），用于和真实券商可能不同、需要注意的地方。 */
  | { t: 'warn'; text: Inline };

export interface QuizQuestion {
  q: string;
  options: string[];
  /** 正确选项的下标。 */
  answer: number;
  /** 答完后显示的解释（答对答错都显示）。 */
  explain: string;
}

/**
 * 「去实践」：跳到 App 里能亲手试一下的地方。
 * - route 是导航的路由名，params 是参数（和 RootStackParamList 一致）。
 * - Tabs 的话 params 写 { screen: 'Trade' } 这种。
 */
export interface Practice {
  label: string;
  route: string;
  params?: Record<string, unknown>;
}

export type LessonId =
  | 'time'
  | 't1'
  | 'limit'
  | 'cage'
  | 'unit'
  | 'fee'
  | 'div'
  | 'exright'
  | 'st'
  | 'ipo'
  | 'boards'
  | 'kinds';

export interface Lesson {
  id: LessonId;
  title: string;
  /** 一句话摘要：列表页副标题、AI 页面上下文的「讲解要点」。 */
  summary: string;
  blocks: LessonBlock[];
  quiz: QuizQuestion[];
  practice?: Practice[];
  /** 对应的 TRADING_RULES.md 小节，给 AI 的 get_rule 工具引用。 */
  spec: string;
}
