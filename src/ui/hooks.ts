/**
 * 界面层的 hook：拿到 AppCore、按焦点订阅行情、按焦点轮询接口、写浏览日志、登记页面上下文。
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setPageContext, type PageContext } from '../ai/context';
import { ViewLogger } from '../app/activity';
import { useApp, type AppCore } from '../app/boot';
import * as repo from '../data/repos';
import { beijingIso } from '../market/clock';

export function useCore(): AppCore {
  const core = useApp(s => s.core);
  if (!core) {
    throw new Error('AppCore 还没准备好');
  }
  return core;
}

/** 报价、交易时段或账户变化时重新读取；重复报价不触发重画。 */
export function useLive(): void {
  useApp(s => s.tick);
  useApp(s => s.version);
}

// ---------- 行情订阅 ----------

const subs = new Map<number, string[]>();
let nextSub = 1;

function applySubs(core: AppCore): void {
  core.refresher.setExtraCodes([...new Set([...subs.values()].flat())]);
}

/** 页面获得焦点时把要看的代码交给 Refresher（多个页面合并），失去焦点时撤掉。 */
export function useQuoteCodes(codes: string[]): void {
  const core = useCore();
  const key = [...new Set(codes)].sort().join(',');
  useFocusEffect(
    useCallback(() => {
      if (!key) {
        return;
      }
      const id = nextSub++;
      subs.set(id, key.split(','));
      applySubs(core);
      return () => {
        subs.delete(id);
        applySubs(core);
      };
    }, [core, key]),
  );
}

/** FlatList / SectionList 仅订阅可见行；scope 隔离不同榜单，滚动后撤掉离屏证券的快速报价。 */
const QUOTE_VIEWABILITY = {
  itemVisiblePercentThreshold: 10,
  minimumViewTime: 100,
};
export function useVisibleCodes<T extends { code: string }>(scope: string) {
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [visible, setVisible] = useState<{ scope: string; codes: string[] }>({
    scope,
    codes: [],
  });
  const onViewableItemsChanged = useMemo(
    () =>
      ({
        viewableItems,
      }: {
        viewableItems: { item: T; isViewable: boolean }[];
      }) => {
        if (scope !== currentScope.current) {
          return;
        }
        const codes = [
          ...new Set(
            viewableItems
              .filter(v => v.isViewable && v.item?.code)
              .map(v => v.item.code),
          ),
        ].sort();
        setVisible(old =>
          old.scope === scope && old.codes.join(',') === codes.join(',')
            ? old
            : { scope, codes },
        );
      },
    [scope],
  );
  return {
    visibleCodes: visible.scope === scope ? visible.codes : [],
    onViewableItemsChanged,
    viewabilityConfig: QUOTE_VIEWABILITY,
  };
}

// ---------- 轮询 ----------

export interface Polled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  at: number | null;
}

/**
 * 页面在焦点上时调用 fetch；intervalMs 为 null 时只取一次（deps 变了再取）。
 * 交易时段才轮询，由调用方根据 status.window 传 interval。
 */
export function usePolling<T>(
  fetch: () => Promise<T>,
  deps: unknown[],
  intervalMs: number | null,
): Polled<T> {
  const [state, setState] = useState<Polled<T>>({
    data: null,
    error: null,
    loading: true,
    at: null,
  });
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  const depKey = JSON.stringify(deps);
  // 换了参数（例如换了板块）先清掉旧数据，免得显示错的
  useEffect(() => {
    setState({ data: null, error: null, loading: true, at: null });
  }, [depKey]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const run = async () => {
        try {
          const data = await fetchRef.current();
          if (alive) {
            setState({ data, error: null, loading: false, at: Date.now() });
          }
        } catch (e) {
          if (alive) {
            setState(s => ({
              ...s,
              error: e instanceof Error ? e.message : String(e),
              loading: false,
            }));
          }
        }
        if (alive && intervalMs != null) {
          timer = setTimeout(run, intervalMs);
        }
      };
      run();
      return () => {
        alive = false;
        if (timer) {
          clearTimeout(timer);
        }
      };
      // depKey 不在回调里用到，但换了参数要重新开始轮询；fetch 本身通过 ref 拿最新的
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depKey, intervalMs]),
  );
  return state;
}

// ---------- 操作日志 ----------

let logger: ViewLogger | null = null;

export function viewLogger(core: AppCore): ViewLogger {
  logger ??= new ViewLogger(a =>
    repo.logActivity(core.db, {
      accountId: core.sim.accountId,
      tradeDate: core.sim.engine.state.date,
      ts: beijingIso(),
      ...a,
    }),
  );
  return logger;
}

/** 页面获得焦点时记一条浏览（连续停留在同一页面只记一次）。 */
export function useViewLog(key: string, text: string | null): void {
  const core = useCore();
  useFocusEffect(
    useCallback(() => {
      if (text) {
        viewLogger(core)
          .view(key, text)
          .catch(() => undefined);
      }
    }, [core, key, text]),
  );
}

// ---------- 页面上下文 ----------

/** 页面获得焦点时登记 aiContext；get 每次提问时重新调用，所以总是最新值。 */
export function useAiContext(route: string, get: () => PageContext): void {
  const ref = useRef(get);
  ref.current = get;
  useFocusEffect(
    useCallback(() => {
      setPageContext(route, () => ref.current());
    }, [route]),
  );
}
