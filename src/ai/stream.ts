/** SSE 分帧与两种模型协议的增量响应。完整结束后才交出工具调用和原始推理内容。 */
import {
  errorMessageOf,
  parseResponse,
  ProtocolError,
  type ParsedResponse,
} from './protocol';
import type { ModelProgress, Protocol } from './types';
import { evidenceOf } from './evidence';

export class ModelStream {
  private buffer = '';
  private data: string[] = [];
  private event = '';
  private response: any = null;
  private items = new Map<number, any>();
  private args = new Map<number, string>();
  private stopped = new Set<number>();
  private complete = false;
  private lastText = '';
  private lastProgress = '';

  private text(value: string): void {
    if (value && value !== this.lastText) {
      this.lastText = value;
      this.onText?.(value);
    }
  }
  private progress(value: ModelProgress): void {
    if (!value.thinking && !value.search) {
      return;
    }
    const key = JSON.stringify(value);
    if (key !== this.lastProgress) {
      this.lastProgress = key;
      this.onProgress?.(value);
    }
  }

  constructor(
    private protocol: Protocol,
    private model: string,
    private onText?: (text: string) => void,
    private onProgress?: (progress: ModelProgress) => void,
  ) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const at = this.buffer.search(/[\r\n]/);
      if (
        at < 0 ||
        (this.buffer[at] === '\r' && at === this.buffer.length - 1)
      ) {
        return;
      }
      const line = this.buffer.slice(0, at).replace(/^\uFEFF/, '');
      const size = this.buffer.slice(at, at + 2) === '\r\n' ? 2 : 1;
      this.buffer = this.buffer.slice(at + size);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (!line) {
      if (this.data.length) {
        const data = this.data.join('\n');
        if (data !== '[DONE]') {
          let value: any;
          try {
            value = JSON.parse(data);
          } catch {
            throw new ProtocolError('流式响应包含不完整或无效的事件');
          }
          if (!value || typeof value !== 'object') {
            throw new ProtocolError('流式响应事件不是 JSON 对象');
          }
          this.accept(value.type ? value : { ...value, type: this.event });
        }
      }
      this.data = [];
      this.event = '';
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') {
      this.data.push(value);
    } else if (field === 'event') {
      this.event = value;
    }
  }

  private ordered(): any[] {
    return [...this.items.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }

  private publish(): void {
    const items = this.ordered();
    if (this.protocol === 'chat') {
      if (this.response?.choices?.[0]?.message?.content) {
        this.text(this.response.choices[0].message.content);
      }
      if (this.response) {
        this.progress(evidenceOf('chat', this.response));
      }
      return;
    }
    this.progress(
      evidenceOf(
        this.protocol,
        this.protocol === 'anthropic' ? { content: items } : { output: items },
      ),
    );
    const text =
      this.protocol === 'anthropic'
        ? items
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n')
        : items
            .filter(b => b.type === 'message')
            .map(b =>
              (b.content ?? [])
                .map((c: any) =>
                  c?.type === 'output_text'
                    ? c.text
                    : c?.type === 'refusal'
                    ? c.refusal
                    : '',
                )
                .join(''),
            )
            .join('\n');
    if (text) {
      this.text(text);
    }
  }

  private accept(e: any): void {
    if (e.type === 'error' || e.type === 'response.failed') {
      throw new ProtocolError(
        errorMessageOf(e.response ?? e, '模型流式响应出错'),
      );
    }
    if (this.protocol === 'anthropic') {
      this.anthropic(e);
    } else if (this.protocol === 'chat') {
      this.chat(e);
    } else {
      this.openai(e);
    }
  }

  private anthropic(e: any): void {
    switch (e.type) {
      case 'message_start':
        this.response = { ...e.message, content: [] };
        break;
      case 'content_block_start':
        this.items.set(e.index, { ...e.content_block });
        this.publish();
        break;
      case 'content_block_delta': {
        const block = this.items.get(e.index);
        if (!block) {
          throw new ProtocolError('流式响应缺少内容块起点');
        }
        const d = e.delta;
        if (d.type === 'input_json_delta') {
          this.args.set(
            e.index,
            (this.args.get(e.index) ?? '') + d.partial_json,
          );
        } else if (d.type === 'text_delta') {
          block.text = (block.text ?? '') + d.text;
          this.publish();
        } else if (d.type === 'thinking_delta') {
          block.thinking = (block.thinking ?? '') + d.thinking;
          this.publish();
        } else if (d.type === 'citations_delta') {
          block.citations = [...(block.citations ?? []), d.citation];
          this.publish();
        } else if (d.type === 'signature_delta') {
          block.signature = (block.signature ?? '') + d.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const args = this.args.get(e.index);
        if (args) {
          try {
            this.items.get(e.index).input = JSON.parse(args);
          } catch {
            throw new ProtocolError('流式工具参数不是完整的 JSON');
          }
        }
        this.stopped.add(e.index);
        this.publish();
        break;
      }
      case 'message_delta':
        if (this.response) {
          this.response = {
            ...this.response,
            ...e.delta,
            usage: { ...this.response.usage, ...e.usage },
          };
        }
        break;
      case 'message_stop':
        if (
          !this.response ||
          [...this.items.keys()].some(i => !this.stopped.has(i))
        ) {
          throw new ProtocolError('流式响应的内容块尚未结束');
        }
        this.response.content = this.ordered();
        this.complete = true;
        break;
    }
  }

  private openai(e: any): void {
    const index = e.output_index;
    switch (e.type) {
      case 'response.reasoning_summary_part.added':
        if (this.items.has(index)) {
          (this.items.get(index).summary ??= [])[e.summary_index] = e.part;
        }
        break;
      case 'response.reasoning_summary_text.delta': {
        const item = this.items.get(index);
        if (item) {
          const summary = (item.summary ??= []);
          const p = (summary[e.summary_index] ??= {
            type: 'summary_text',
            text: '',
          });
          p.text += e.delta;
          this.publish();
        }
        break;
      }
      case 'response.output_text.annotation.added': {
        const msg = this.message(index, e.item_id),
          p = msg.content[e.content_index];
        if (p) {
          (p.annotations ??= []).push(e.annotation);
          this.publish();
        }
        break;
      }
      case 'response.created':
      case 'response.in_progress':
        this.response = e.response;
        break;
      case 'response.output_item.added':
      case 'response.output_item.done':
        this.items.set(index, { ...e.item });
        this.publish();
        break;
      case 'response.content_part.added':
      case 'response.content_part.done':
        this.message(index, e.item_id).content[e.content_index] = { ...e.part };
        this.publish();
        break;
      case 'response.output_text.delta':
      case 'response.output_text.done':
      case 'response.refusal.delta':
      case 'response.refusal.done': {
        const msg = this.message(index, e.item_id);
        const refusal = e.type.startsWith('response.refusal.');
        const key = refusal ? 'refusal' : 'text';
        const part = msg.content[e.content_index] ?? {
          type: refusal ? 'refusal' : 'output_text',
          [key]: '',
        };
        part[key] = e.type.endsWith('.delta')
          ? (part[key] ?? '') + e.delta
          : e[key];
        msg.content[e.content_index] = part;
        this.publish();
        break;
      }
      case 'response.function_call_arguments.delta':
      case 'response.function_call_arguments.done': {
        const item = this.items.get(index);
        if (!item) {
          throw new ProtocolError('流式响应缺少工具调用起点');
        }
        item.arguments = e.type.endsWith('.delta')
          ? (item.arguments ?? '') + e.delta
          : e.arguments;
        break;
      }
      case 'response.completed':
      case 'response.incomplete':
        this.response = {
          ...e.response,
          output: e.response?.output ?? this.ordered(),
        };
        this.complete = true;
        break;
    }
  }

  private chat(e: any): void {
    if (e.error) {
      throw new ProtocolError(errorMessageOf(e, '模型流式响应出错'));
    }
    if (!Array.isArray(e.choices)) {
      return;
    }
    if (!this.response) {
      this.response = {
        model: e.model,
        choices: [
          { message: { role: 'assistant', content: '' }, finish_reason: null },
        ],
        usage: null,
      };
    }
    if (e.model) {
      this.response.model = e.model;
    }
    if (e.usage) {
      this.response.usage = e.usage;
    }
    if (e.web_search) {
      this.response.web_search = e.web_search;
    }
    if (e.search_info) {
      this.response.search_info = e.search_info;
    }
    const c = e.choices.find((x: any) => x.index === 0) ?? e.choices[0];
    if (!c) {
      this.publish();
      return;
    }
    const d = c.delta ?? {},
      m = this.response.choices[0].message;
    for (const k of ['content', 'reasoning_content', 'reasoning']) {
      if (typeof d[k] === 'string') {
        m[k] = (m[k] ?? '') + d[k];
      }
    }
    if (d.annotations) {
      m.annotations = [...(m.annotations ?? []), ...d.annotations];
    }
    for (const t of d.tool_calls ?? []) {
      let call = this.items.get(t.index);
      if (!call) {
        call = {
          id: t.id,
          type: 'function',
          function: { name: '', arguments: '' },
        };
        this.items.set(t.index, call);
      }
      if (t.id) {
        call.id = t.id;
      }
      if (t.function?.name) {
        call.function.name += t.function.name;
      }
      if (t.function?.arguments) {
        call.function.arguments += t.function.arguments;
      }
    }
    if (this.items.size) {
      m.tool_calls = this.ordered();
    }
    if (c.finish_reason) {
      this.response.choices[0].finish_reason = c.finish_reason;
      this.complete = true;
    }
    this.publish();
  }

  private message(index: number, id: string): any {
    if (!this.items.has(index)) {
      this.items.set(index, {
        type: 'message',
        role: 'assistant',
        id,
        content: [],
      });
    }
    return this.items.get(index);
  }

  finish(): ParsedResponse {
    if (this.buffer) {
      this.line(this.buffer.replace(/\r$/, ''));
      this.buffer = '';
    }
    this.line('');
    if (!this.complete) {
      throw new ProtocolError(
        '回答连接中断，未收到结束事件；已收到的文字会保留，请重试',
      );
    }
    return parseResponse(this.protocol, this.model, this.response);
  }
}
