/** 从真实 /models 响应获取模型；先完成所有分页，失败时不覆盖用户原来的模型与标注。 */
import {
  AiError,
  defaultFetch,
  httpError,
  redact,
  type FetchLike,
} from './http';
import { endpointOf, errorMessageOf, headersOf } from './protocol';
import type { AiProvider, ModelEntry } from './types';

export async function listModels(
  provider: AiProvider,
  key: string,
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<ModelEntry[]> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  opts.signal?.addEventListener('abort', abort);
  if (opts.signal?.aborted) {
    ctl.abort();
  }
  const timer = setTimeout(abort, 45_000);
  const entries = new Map<string, ModelEntry>();
  const cursors = new Set<string>();
  let after = '';
  try {
    for (let page = 0; page < 20; page++) {
      const url =
        endpointOf(provider.protocol, provider.baseUrl, 'models') +
        (after ? '?after_id=' + encodeURIComponent(after) : '');
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: headersOf(provider, key),
        body: '',
        signal: ctl.signal,
      });
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (res.status < 200 || res.status >= 300) {
        throw httpError(
          res.status,
          redact(errorMessageOf(json, text.slice(0, 150)), key),
        );
      }
      if (!Array.isArray(json?.data)) {
        throw new AiError(
          'protocol',
          '模型列表响应里没有 data 数组，检查协议和 Base URL',
        );
      }
      for (const item of json.data) {
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        if (!id || /\s/.test(id)) {
          continue;
        }
        const old = provider.models.find(m => m.id === id);
        const context =
          item.context_length ?? item.context_window ?? item.max_input_tokens;
        entries.set(id, {
          id,
          name: typeof item.name === 'string' ? item.name : undefined,
          enabled: old?.enabled ?? false,
          price: old?.price ?? null,
          overrides: {
            ...(typeof context === 'number' && context > 0 ? { context } : {}),
            ...old?.overrides,
          },
        });
      }
      if (!json.has_more) {
        // 手动添加但未出现在列表里的模型仍保留，避免供应商暂时隐藏模型时丢配置。
        for (const old of provider.models) {
          if (!entries.has(old.id)) {
            entries.set(old.id, old);
          }
        }
        return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
      }
      if (typeof json.last_id !== 'string' || cursors.has(json.last_id)) {
        throw new AiError('protocol', '模型列表分页游标无效，请重试或手动添加');
      }
      after = json.last_id;
      cursors.add(after);
    }
    throw new AiError(
      'protocol',
      '模型列表超过 20 页，未覆盖已有配置；请手动添加需要的模型',
    );
  } catch (e) {
    if (e instanceof AiError) {
      throw e;
    }
    if (ctl.signal.aborted) {
      throw new AiError(
        opts.signal?.aborted ? 'cancelled' : 'timeout',
        opts.signal?.aborted
          ? '已取消获取模型'
          : '获取模型超时，请检查地址后重试',
      );
    }
    throw new AiError(
      'network',
      '获取模型列表失败：' +
        redact(e instanceof Error ? e.message : String(e), key),
    );
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', abort);
  }
}
