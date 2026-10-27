/**
 * 发请求：普通 JSON 使用 fetch，流式 SSE 使用 React Native XHR 的增量文本事件。
 * 错误统一成一句人话，Key 不出现在任何错误里。
 *
 * 兼容服务（§6.4）：服务回 400 且说的是缓存字段（cache_control / prompt_cache_key）或思考字段
 * （thinking / output_config / reasoning）不认识时，标出 compat，由调用方去掉这些字段重发一次并记住。
 */
import {
  errorMessageOf,
  headersOf,
  parseResponse,
  ProtocolError,
  type BuiltRequest,
  type ParsedResponse,
} from './protocol';
import type { AiService } from './types';
import { ModelStream } from './stream';

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
    /** 每次新收到的文本片段。RN fetch 没有可读流，用 XHR progress 接收。 */
    onChunk?: (chunk: string) => void;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export const defaultFetch: FetchLike = (url, init) => {
  const { onChunk, ...request } = init;
  return onChunk ? xhrFetch(url, init) : fetch(url, request as RequestInit);
};

const xhrFetch: FetchLike = (url, init) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let offset = 0;
    let settled = false;
    const cleanup = () => init.signal?.removeEventListener('abort', onAbort);
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
      xhr.abort();
    };
    const onAbort = () => fail(new Error('请求已停止'));
    const progress = () => {
      if (settled || xhr.status < 200 || xhr.status >= 300) {
        return;
      }
      try {
        const chunk = xhr.responseText.slice(offset);
        offset = xhr.responseText.length;
        if (chunk) {
          init.onChunk?.(chunk);
        }
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    };
    xhr.open(init.method, url, true);
    xhr.responseType = 'text';
    for (const [name, value] of Object.entries(init.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.onprogress = progress;
    xhr.onload = () => {
      progress();
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const text = xhr.responseText;
      resolve({ status: xhr.status, text: async () => text });
    };
    xhr.onerror = () => fail(new Error('网络连接中断'));
    xhr.onabort = onAbort;
    init.signal?.addEventListener('abort', onAbort);
    if (init.signal?.aborted) {
      onAbort();
      return;
    }
    xhr.send(init.body);
  });

export type AiErrorCode =
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'server'
  | 'bad_request'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'protocol';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status: number | null = null,
    /** 400 是因为服务不认缓存字段 / 思考字段。 */
    readonly compat: 'cache' | 'effort' | null = null,
  ) {
    super(message);
  }
}

/** 把 Key 从文字里去掉（中转服务的报错偶尔会带上请求头）。 */
export function redact(text: string, key: string): string {
  let out = text;
  if (key && key.length >= 6) {
    out = out.split(key).join('••••');
  }
  return out.replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{8,}/g, '$1••••');
}

export function compatOf(message: string): 'cache' | 'effort' | null {
  if (/cache_control|prompt_cache_key|cache/i.test(message)) {
    return 'cache';
  }
  if (/thinking|output_config|effort|reasoning|include/i.test(message)) {
    return 'effort';
  }
  return null;
}

function httpError(status: number, message: string): AiError {
  const short = message.slice(0, 300);
  if (status === 401 || status === 403) {
    return new AiError(
      'auth',
      'API Key 无效或没有权限（HTTP ' + status + '）：' + short,
      status,
    );
  }
  if (status === 404) {
    return new AiError(
      'not_found',
      '地址或模型不对（HTTP 404）：' + short + '。检查 Base URL 和模型名',
      status,
    );
  }
  if (status === 429) {
    return new AiError(
      'rate_limit',
      '请求太频繁或额度用完了（HTTP 429）：' + short,
      status,
    );
  }
  if (status >= 500) {
    return new AiError(
      'server',
      '服务端出错（HTTP ' + status + '），稍后再试：' + short,
      status,
    );
  }
  return new AiError(
    'bad_request',
    '请求被拒绝（HTTP ' + status + '）：' + short,
    status,
    status === 400 || status === 422 ? compatOf(message) : null,
  );
}

export interface CallResult {
  parsed: ParsedResponse;
  latencyMs: number;
}

export async function callModel(
  service: AiService,
  key: string,
  req: BuiltRequest,
  opts: {
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    onText?: (text: string) => void;
  } = {},
): Promise<CallResult> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, opts.timeoutMs ?? 180_000);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  if (opts.signal?.aborted) {
    ctl.abort();
  }
  const stream =
    req.body.stream === true
      ? new ModelStream(service.protocol, service.model, opts.onText)
      : null;
  let receivedChunks = false;
  const started = Date.now();
  let status: number;
  let text: string;
  try {
    const res = await fetchImpl(req.url, {
      method: 'POST',
      headers: {
        ...headersOf(service, key),
        ...(stream ? { Accept: 'text/event-stream' } : {}),
      },
      body: JSON.stringify(req.body),
      signal: ctl.signal,
      ...(stream
        ? {
            onChunk: (chunk: string) => {
              receivedChunks = true;
              stream.feed(chunk);
            },
          }
        : {}),
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    if (opts.signal?.aborted) {
      throw new AiError('cancelled', '已停止');
    }
    if (timedOut) {
      throw new AiError('timeout', '等了 3 分钟没有响应，已放弃');
    }
    if (e instanceof ProtocolError) {
      throw new AiError('protocol', redact(e.message, key));
    }
    throw new AiError(
      'network',
      '连不上 ' +
        req.url.replace(/^https?:\/\/([^/]+).*$/, '$1') +
        '：' +
        redact(e instanceof Error ? e.message : String(e), key),
    );
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 中转服务出错时常常返回 HTML，按状态码处理
  }
  if (status < 200 || status >= 300) {
    throw httpError(
      status,
      redact(errorMessageOf(json, text.slice(0, 200) || '没有说明'), key),
    );
  }
  if (json == null && !stream) {
    throw new AiError(
      'protocol',
      '响应不是 JSON：' + redact(text.slice(0, 120), key),
    );
  }
  try {
    return {
      parsed:
        json != null
          ? parseResponse(service.protocol, service.model, json)
          : (() => {
              if (!receivedChunks) {
                stream!.feed(text);
              }
              return stream!.finish();
            })(),
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    if (e instanceof ProtocolError) {
      throw new AiError(
        'protocol',
        redact(e.message, key) + '。协议选对了吗？（' + service.protocol + '）',
      );
    }
    throw e;
  }
}
