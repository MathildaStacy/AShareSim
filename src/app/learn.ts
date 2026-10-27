/**
 * 学习进度（M3）：路线图勾选、规则课小测、演示完成。存在 learn_check / quiz_answer 两张表，
 * 不属于某个账户（重置账户不清，PRODUCT_DESIGN §10）。学习操作记操作日志（kind learn）。
 *
 * 自动打勾在这些时候检查：打开学习页 / 阶段页、有成交、看过交割单、小测和演示答完。
 */
import { create } from 'zustand';
import * as repo from '../data/repos';
import type { LearnCheck, QuizAnswer } from '../data/repos';
import { lessonById } from '../learn/lessons';
import {
  AUCTION_DEMO_ID,
  lessonCheckId,
  lessonStatus,
} from '../learn/progress';
import { evaluateAuto, itemById, type Checks } from '../learn/roadmap';
import { beijingIso } from '../market/clock';
import { toast } from '../ui/toast';
import type { AppCore } from './boot';

interface LearnStore {
  loaded: boolean;
  checks: Checks;
  answers: QuizAnswer[];
  /** 自动项还差什么（阶段页显示）。 */
  missing: Record<string, string[]>;
  /** 这次打开 App 以来自动打勾的项（学习 Tab 的页面上下文用）。 */
  recent: string[];
}

export const useLearn = create<LearnStore>(() => ({
  loaded: false,
  checks: {},
  answers: [],
  missing: {},
  recent: [],
}));

const toChecks = (rows: LearnCheck[]): Checks =>
  Object.fromEntries(rows.map(r => [r.id, r]));

async function log(core: AppCore, text: string, ref: Record<string, unknown>) {
  await repo.logActivity(core.db, {
    accountId: core.sim.accountId,
    tradeDate: core.sim.engine.state.date,
    ts: beijingIso(),
    kind: 'learn',
    text,
    ref,
  });
}

async function reload(core: AppCore): Promise<void> {
  const [rows, answers] = await Promise.all([
    repo.learnChecks(core.db),
    repo.quizAnswers(core.db),
  ]);
  useLearn.setState({ loaded: true, checks: toChecks(rows), answers });
}

let syncing: Promise<string[]> | null = null;

/** 检查自动项，新满足的记下完成日期并提示。返回新打勾的项的文字。 */
export function syncLearn(core: AppCore): Promise<string[]> {
  syncing ??= doSync(core).finally(() => {
    syncing = null;
  });
  return syncing;
}

async function doSync(core: AppCore): Promise<string[]> {
  await reload(core);
  const { checks } = useLearn.getState();
  const accounts = await repo.allAccounts(core.db);
  const states = accounts.map(a =>
    a.id === core.sim.accountId ? core.sim.engine.state : a.state,
  );
  if (!accounts.some(a => a.id === core.sim.accountId)) {
    states.push(core.sim.engine.state);
  }
  const auto = evaluateAuto({
    states,
    nameOf: c => core.sim.security(c)?.name ?? c,
    ledgerViewedAt: await repo.lastViewOf(core.db, 'orders:ledger'),
    feeLessonPassed: !!checks[lessonCheckId('fee')],
    auctionDemoDone: !!checks[AUCTION_DEMO_ID],
  });
  const added: string[] = [];
  const now = beijingIso();
  for (const [id, r] of Object.entries(auto)) {
    if (!r.done || checks[id]) {
      continue;
    }
    const ok = await repo.addLearnCheck(core.db, {
      id,
      auto: true,
      doneAt: now,
      basis: r.basis,
    });
    if (ok) {
      const text = itemById(id)?.text ?? id;
      added.push(text);
      await log(core, '学习进度：自动打勾「' + text + '」（' + r.basis + '）', {
        check: id,
      });
    }
  }
  const missing = Object.fromEntries(
    Object.entries(auto).map(([id, r]) => [id, r.missing]),
  );
  if (added.length) {
    await reload(core);
  }
  useLearn.setState(s => ({ missing, recent: [...s.recent, ...added] }));
  for (const t of added) {
    toast.show('学习进度 ✓ ' + t, 'learn');
  }
  return added;
}

/** 手动勾选或取消（自动项不能手动改）。 */
export async function toggleCheck(core: AppCore, id: string): Promise<void> {
  const item = itemById(id);
  if (!item) {
    return;
  }
  if (item.auto) {
    toast.show('这一项由 App 根据你的操作自动判断');
    return;
  }
  const { checks } = useLearn.getState();
  if (checks[id]) {
    await repo.removeLearnCheck(core.db, id);
    await log(core, '取消勾选「' + item.text + '」', { check: id, on: false });
  } else {
    await repo.addLearnCheck(core.db, {
      id,
      auto: false,
      doneAt: beijingIso(),
      basis: '手动勾选',
    });
    await log(core, '勾选「' + item.text + '」', { check: id, on: true });
  }
  await reload(core);
}

/** 回答规则课的一道小测；这一课全部答对时记「通过」（之后重做不会取消）。 */
export async function answerQuiz(
  core: AppCore,
  lessonId: string,
  q: number,
  choice: number,
): Promise<void> {
  const lesson = lessonById(lessonId);
  const question = lesson?.quiz[q];
  if (!lesson || !question) {
    return;
  }
  const correct = choice === question.answer;
  await repo.saveQuizAnswer(core.db, {
    lesson: lessonId,
    q,
    choice,
    correct,
    answeredAt: beijingIso(),
  });
  await log(
    core,
    '规则课「' +
      lesson.title +
      '」第 ' +
      (q + 1) +
      ' 题选「' +
      question.options[choice] +
      '」，' +
      (correct ? '答对' : '答错'),
    { lesson: lessonId, q, choice, correct },
  );
  await reload(core);
  const st = lessonStatus(lesson, useLearn.getState().answers);
  if (st.allCorrect) {
    const added = await repo.addLearnCheck(core.db, {
      id: lessonCheckId(lessonId),
      auto: true,
      doneAt: beijingIso(),
      basis: '小测全部答对',
    });
    if (added) {
      await log(core, '规则课「' + lesson.title + '」通过（小测全部答对）', {
        lesson: lessonId,
        passed: true,
      });
      toast.show('规则课「' + lesson.title + '」通过', 'learn');
    }
    await syncLearn(core);
  }
}

/** 重做：清掉这一课的作答，已经记下的通过不受影响。 */
export async function redoLesson(core: AppCore, lessonId: string) {
  await repo.clearQuiz(core.db, lessonId);
  await reload(core);
}

/** 集合竞价演示的小测：答对记「演示完成」。 */
export async function answerAuctionQuiz(
  core: AppCore,
  question: string,
  answer: string,
  correct: boolean,
): Promise<void> {
  await log(
    core,
    '集合竞价演示小测「' +
      question +
      '」答 ' +
      answer +
      '，' +
      (correct ? '答对' : '答错'),
    { demo: 'auction', correct },
  );
  if (!correct) {
    return;
  }
  const added = await repo.addLearnCheck(core.db, {
    id: AUCTION_DEMO_ID,
    auto: true,
    doneAt: beijingIso(),
    basis: '集合竞价演示的小测答对',
  });
  if (added) {
    await syncLearn(core);
  }
}

/** 学习页里其他值得记的操作（打开演示加单、导出数据……）。 */
export function logLearn(
  core: AppCore,
  text: string,
  ref: Record<string, unknown> = {},
): Promise<void> {
  return log(core, text, ref);
}
