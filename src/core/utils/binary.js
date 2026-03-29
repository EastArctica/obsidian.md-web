import { Buffer } from 'buffer';
import path from 'path-browserify';

export function normalizeEncoding(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.encoding === 'string') return value.encoding;
  return null;
}

export function isBinaryLike(value) {
  return value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob;
}

export function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new TextEncoder().encode(String(value ?? ''));
}

export function isTextLikePath(filePath) {
  return /\.(md|txt|json|canvas|svg|css|js|ts|html|xml|yml|yaml)$/i.test(String(filePath));
}

export function mimeTypeForPath(filePath, mimeByExtension) {
  return mimeByExtension[path.extname(String(filePath)).toLowerCase()] || 'application/octet-stream';
}

export function missingFileFallback(filePath, options, isObsidianConfigJson) {
  if (isObsidianConfigJson(filePath)) {
    const encoding = normalizeEncoding(options);
    if (encoding === 'utf8' || encoding === 'utf-8') return '{}';
    return Buffer.from('{}', 'utf8');
  }
  const encoding = normalizeEncoding(options);
  if (encoding === 'utf8' || encoding === 'utf-8') return '';
  return Buffer.from('', 'utf8');
}
