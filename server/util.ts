import crypto from 'node:crypto';

/** fetch + JSON。失敗時はクエリ文字列（トークン等）を含まないメッセージで例外を投げる */
export async function httpJson(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 300);
    const err: any = new Error(`HTTP ${res.status} ${url.split('?')[0]}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- in-memory sliding-window rate limiter ----------

const hits = new Map<string, number[]>();

/** すべてのキーが上限未満なら全キーを1回消費して true。1つでも上限なら何も消費せず false */
export function tryConsume(keys: { key: string; max: number }[], windowMs: number): boolean {
  const now = Date.now();
  const arrs = keys.map(({ key }) => {
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    hits.set(key, arr);
    return arr;
  });
  if (keys.some((k, i) => arrs[i].length >= k.max)) return false;
  arrs.forEach((a) => a.push(now));
  if (hits.size > 20_000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  }
  return true;
}

export function resetLimits() {
  hits.clear();
}

// ---------- text helpers ----------

export function clipChars(s: string, max: number): string {
  const a = Array.from(s);
  return a.length <= max ? s : a.slice(0, max - 1).join('') + '…';
}

export function clipBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let out = '';
  for (const ch of Array.from(s)) {
    if (Buffer.byteLength(out + ch + '…', 'utf8') > maxBytes) break;
    out += ch;
  }
  return out + '…';
}

/**
 * 環境変数が「実際に設定されているか」。空文字や .env.example の仮の値（MY_GEMINI_API_KEY など）は未設定扱い。
 *
 * @example
 * envValue('GEMINI_API_KEY'); // 未設定なら ''
 */
export function envValue(name: string): string {
  const v = (process.env[name] || '').trim();
  if (!v || /^MY_[A-Z_]+$/.test(v) || /^ここに/.test(v)) return '';
  return v;
}

export function cleanInput(s: unknown, max = 2000): string {
  if (typeof s !== 'string') return '';
  // 制御文字を除去（改行・タブは残す）
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function verifyHmac(
  secret: string | undefined,
  raw: string,
  given: string | undefined,
  encoding: 'hex' | 'base64',
  prefix = ''
): boolean {
  if (!secret || !given) return false;
  const expected = prefix + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest(encoding);
  return safeEqual(expected, given);
}
