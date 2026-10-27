/** SSE 分帧与两种模型协议的增量响应。完整结束后才交出工具调用和原始推理内容。 */
import {
  errorMessageOf,
  parseResponse,
  ProtocolError,
  type ParsedResponse,
} from './protocol';
import type { Protocol } from './types';

export class ModelStream {
  private buffer = '';
  private data: string[] = [];
  private event = '';
  private response: any = null;
  private items = new Map<number, any>();
  private args = new Map<number, string>();
  private stopped = new Set<number>();
  private complete = false;

  constructor(
    private protocol: Protocol,
    private model: string,
    private onText?: (text: string) => void,
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
      this.onText?.(text);
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
