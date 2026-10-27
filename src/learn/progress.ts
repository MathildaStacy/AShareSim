/**
 * 学习进度的纯逻辑：规则课的小测状态、完成项的 id。存取在 src/app/learn.ts。
 */
import type { QuizAnswer } from '../data/repos';
import type { Board } from '../engine/securities';
import type { Lesson, LessonId } from './types';

/** learn_check 里规则课通过、演示完成的 id。 */
export const lessonCheckId = (lessonId: string) => 'lesson:' + lessonId;
export const AUCTION_DEMO_ID = 'demo:auction';

export interface LessonStatus {
  answered: number;
  correct: number;
  total: number;
  /** 这一轮全部答对。 */
  allCorrect: boolean;
}

export function lessonStatus(
  lesson: Lesson,
  answers: QuizAnswer[],
): LessonStatus {
  const mine = answers.filter(a => a.lesson === lesson.id);
  const correct = mine.filter(a => a.correct).length;
  return {
    answered: mine.length,
    correct,
    total: lesson.quiz.length,
    allCorrect: correct === lesson.quiz.length,
  };
}

/** 一道题的作答：未答 / 答对 / 答错。 */
export function answerOf(
  answers: QuizAnswer[],
  lessonId: string,
  q: number,
): QuizAnswer | undefined {
  return answers.find(a => a.lesson === lessonId && a.q === q);
}

/** 个股页规则卡下面的「相关规则课」：按板块和是否 ST 挑。 */
export function relatedLessons(board: Board, isST: boolean): LessonId[] {
  if (board === 'etf') {
    return ['t1', 'limit', 'unit', 'fee'];
  }
  return [
    ...(isST ? (['st'] as LessonId[]) : []),
    'limit',
    'cage',
    'unit',
    ...(board === 'main' ? [] : (['boards'] as LessonId[])),
    'kinds',
  ];
}
