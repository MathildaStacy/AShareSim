/**
 * 导出文本文件（交割单 CSV 等）：编码成 UTF-8 → base64 交给原生 DocumentStore，写到缓存目录后打开系统分享面板。
 * CSV 前面加 UTF-8 BOM，Excel 打开中文不乱码。
 */
/* eslint-disable no-bitwise -- UTF-8 和 base64 编码本来就是按位运算 */
import type { Spec } from '../native/NativeDocumentStore';

export type ExportMime = 'text/csv' | 'text/plain' | 'application/json';

/** 导出上限，和原生模块一致。 */
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

const BOM = '\uFEFF';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

let injected: Spec | null | undefined;

/** 测试用：替换原生模块（传 undefined 恢复）。 */
export function setDocumentStore(next: Spec | null | undefined): void {
  injected = next;
}

function store(): Spec | null {
  if (injected !== undefined) {
    return injected;
  }
  return require('../native/NativeDocumentStore').default as Spec | null;
}

/** 字符串 → UTF-8 字节（代理对按一个码点处理，落单的代理换成 U+FFFD）。 */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
    }
  }
  return Uint8Array.from(out);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    s += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return s;
}

/** 文本按 UTF-8 编码成 base64（不用 btoa：它只认 Latin-1，中文会出错）。 */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(utf8Bytes(text));
}

/** 文件名清洗：去掉路径分隔符和控制字符，最长 120 个字符。 */
export function safeFileName(name: string): string {
  const safe = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- 交给原生之前去掉路径分隔符和控制字符
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return [...safe].slice(0, 120).join('') || 'document';
}

/** 导出并打开系统分享面板。Android 上面板打开就返回 'opened'，拿不到用户最后有没有保存。 */
export async function exportText(
  name: string,
  text: string,
  mime: ExportMime,
): Promise<'opened'> {
  const native = store();
  if (!native) {
    throw new Error('这台设备还不支持导出文件');
  }
  const bytes = utf8Bytes(mime === 'text/csv' ? BOM + text : text);
  if (bytes.length > MAX_EXPORT_BYTES) {
    throw new Error('导出内容超过 10 MB');
  }
  try {
    await native.writeAndShare(safeFileName(name), bytesToBase64(bytes), mime);
  } catch (e) {
    const code =
      e && typeof e === 'object' && 'code' in e
        ? (e as { code: unknown }).code
        : null;
    if (code === 'STORAGE_FULL') {
      throw new Error('手机存储空间不足，没有生成导出文件');
    }
    if (code === 'DOCUMENT_BUSY') {
      throw new Error('上一次导出还没结束，稍后再试');
    }
    throw new Error(
      '导出失败：' + (e instanceof Error ? e.message : String(e)),
    );
  }
  return 'opened';
}

/** 清理上一次 App 进程留下的导出文件（启动时调用）；模块不可用或失败时静默。 */
export async function cleanupExports(): Promise<void> {
  const native = store();
  if (!native) {
    return;
  }
  try {
    await native.cleanupExports();
  } catch {
    // 下次启动再清
  }
}

/** 系统文件选择器返回 UTF-8 CSV/JSON，取消返回 null。 */
export async function importText(): Promise<string | null> {
  const native = store();
  if (!native?.pickText) {
    throw new Error('这台设备暂不支持文件导入，请粘贴文件内容');
  }
  return native.pickText();
}
