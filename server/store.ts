import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 超軽量なJSONファイル永続化。
 * - 設定 / 受信ログ / 重複排除ID / 会話履歴 / OAuthトークンを data/db.json に保存します。
 * - 単一プロセス前提です。Cloud Run等の使い捨てファイルシステムで運用する場合は
 *   DATA_DIR を永続ボリュームに向けるか、このファイルをDB実装に差し替えてください。
 */

export type Mode = 'off' | 'draft' | 'auto';
/**
 * 対応チャンネル。
 * X(旧Twitter)は有料APIプランが前提のため、現在は対象外にしています。
 * 再対応する場合は、受け取った元のzipにある server/channels.ts の X 実装を参照してください。
 */
export const CHANNEL_IDS = ['instagram', 'facebook', 'youtube', 'line', 'web'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];
export type Kind = 'dm' | 'comment' | 'web';
export type Status = 'sent' | 'drafted' | 'needs_human' | 'skipped' | 'error' | 'rejected';

export interface ChannelConfig {
  mode: Mode;
  /** このチャンネル専用のCTA文言（空ならボス設定の誘導アクションを使う） */
  ctaOverride: string;
}

export interface Config {
  /** 全体のON/OFF（キルスイッチ）。デフォルトOFF */
  masterEnabled: boolean;
  persona: Record<string, string> | null;
  bossProfile: Record<string, string> | null;
  channels: Record<ChannelId, ChannelConfig>;
  youtube: { channelId: string; pollMinutes: number };
  web: { allowedOrigins: string[]; siteKey: string; holdingMessage: string };
  limits: { perSenderPerHour: number; globalPerHour: number };
  disclosure: { enabled: boolean; text: string };
  handoffKeywords: string[];
  notifyWebhookUrl: string;
  /** 見込み客・要人間対応を、運営者自身のLINEにプッシュ通知する */
  lineNotify: { enabled: boolean; userIds: string[] };
  /** 全受信をGoogleスプレッドシート等に記録するWebhook（Google Apps Script のウェブアプリURLを想定） */
  sheetWebhookUrl: string;
  leadScoreThreshold: number;
  updatedAt: string;
}

export interface Source {
  type?: 'widget' | 'form' | 'api' | 'webhook' | 'poll';
  page?: string;
  utm?: Record<string, string>;
}

export interface Entry {
  id: string;
  createdAt: string;
  channel: ChannelId;
  kind: Kind;
  senderId: string;
  senderName?: string;
  email?: string;
  text: string;
  reply?: string;
  intent?: string;
  leadScore?: number;
  status: Status;
  note?: string;
  /** 返信先の特定に使うプラットフォーム固有ID（commentId, replyToken など） */
  ref: Record<string, string>;
  source?: Source;
  /** /api/v1/reply 経由（呼び出し側が返信を配信する）か */
  viaApi?: boolean;
  conversationKey: string;
}

export interface Msg {
  sender: 'prospect' | 'influencer';
  text: string;
}

interface TokenRec {
  access: string;
  refresh?: string;
  exp: number;
}

interface DB {
  config: Config;
  log: Entry[];
  seen: string[];
  convos: Record<string, Msg[]>;
  tokens: Record<string, TokenRec>;
  kv: Record<string, string>;
  secrets: { apiKey: string };
}

const MAX_LOG = 2000;
const MAX_SEEN = 5000;
const MAX_CONVOS = 2000;
const MAX_MSGS_PER_CONVO = 20;

export const PERSONA_KEYS = ['name', 'role', 'tone', 'relationToBoss', 'visualStyle'] as const;
export const BOSS_KEYS = ['bossName', 'bossTitle', 'bossStrength', 'targetAudience', 'ctaGoal', 'ctaLinkText'] as const;

export const rand = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');

export function defaultConfig(): Config {
  const ch = (): ChannelConfig => ({ mode: 'off', ctaOverride: '' });
  return {
    masterEnabled: false,
    persona: null,
    bossProfile: null,
    channels: { instagram: ch(), facebook: ch(), youtube: ch(), line: ch(), web: ch() },
    youtube: { channelId: '', pollMinutes: 5 },
    web: {
      allowedOrigins: [],
      siteKey: 'pk_' + rand(12),
      holdingMessage: 'メッセージありがとうございます！内容を確認のうえ、担当よりあらためてご返信します。',
    },
    limits: { perSenderPerHour: 6, globalPerHour: 60 },
    // ステマ規制対策: 「運営者の公式AI」であることが伝わる文言を既定にする
    disclosure: { enabled: true, text: '（運営者公式のAIアシスタントによる自動返信です）' },
    handoffKeywords: ['返金', '解約', 'クレーム', '訴訟', '弁護士', '警察', '詐欺', '訴える', '被害'],
    notifyWebhookUrl: '',
    lineNotify: { enabled: false, userIds: [] },
    sheetWebhookUrl: '',
    leadScoreThreshold: 70,
    updatedAt: '',
  };
}

const dataDir = () => path.resolve(process.env.DATA_DIR || 'data');
const dbFile = () => path.join(dataDir(), 'db.json');

function emptyDB(): DB {
  return { config: defaultConfig(), log: [], seen: [], convos: {}, tokens: {}, kv: {}, secrets: { apiKey: '' } };
}

let db: DB | null = null;

/** 保存済みデータから、現在対応しているチャンネルの設定だけを取り出す（旧版の x 設定などを捨てる） */
function pickChannels(base: Config['channels'], saved: any): Config['channels'] {
  const out = { ...base };
  if (!saved || typeof saved !== 'object') return out;
  for (const id of CHANNEL_IDS) {
    if (saved[id] && typeof saved[id] === 'object') out[id] = { ...base[id], ...saved[id] };
  }
  return out;
}

function load(): DB {
  if (db) return db;
  const base = emptyDB();
  try {
    const parsed = JSON.parse(fs.readFileSync(dbFile(), 'utf8'));
    const cfg = parsed.config || {};
    base.config = {
      ...base.config,
      ...cfg,
      channels: pickChannels(base.config.channels, cfg.channels),
      youtube: { ...base.config.youtube, ...(cfg.youtube || {}) },
      web: { ...base.config.web, ...(cfg.web || {}) },
      limits: { ...base.config.limits, ...(cfg.limits || {}) },
      disclosure: { ...base.config.disclosure, ...(cfg.disclosure || {}) },
      lineNotify: { ...base.config.lineNotify, ...(cfg.lineNotify || {}) },
    };
    base.log = Array.isArray(parsed.log) ? parsed.log : [];
    base.seen = Array.isArray(parsed.seen) ? parsed.seen : [];
    base.convos = parsed.convos || {};
    base.tokens = parsed.tokens || {};
    base.kv = parsed.kv || {};
    base.secrets = { apiKey: parsed.secrets?.apiKey || '' };
  } catch {
    /* 初回起動 or 破損 → 初期値 */
  }
  db = base;
  return db;
}

let timer: NodeJS.Timeout | null = null;

function saveNow() {
  if (!db) return;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = dbFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    fs.renameSync(tmp, dbFile());
  } catch (e) {
    console.error('[store] save failed:', (e as Error).message);
  }
}

function scheduleSave() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, 150);
  timer.unref?.();
}

export function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  saveNow();
}

/** テスト用: メモリ上のDBを破棄して再読込させる */
export function resetForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  db = null;
}

process.on('exit', flush);

// ---------- config ----------

export function getConfig(): Config {
  return load().config;
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined;

function pick(obj: any, keys: readonly string[]): Record<string, string> | null {
  if (!obj || typeof obj !== 'object') return null;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const s = str(obj[k], 1500);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

/** SSRF対策の簡易チェック: https かつ内部アドレスでないこと */
export function isSafeWebhookUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    if (h === '::1' || h.startsWith('[')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * LINEのユーザーIDの形式か（「U」＋32桁の16進数）。
 * LINE Developers の「チャネル基本設定」→「あなたのユーザーID」に表示される値。
 *
 * @example
 * isLineUserId('U' + '0'.repeat(32)); // true
 */
export function isLineUserId(v: string): boolean {
  return /^U[0-9a-f]{32}$/.test(v);
}

export function updateConfig(patch: any): Config {
  const d = load();
  const c = d.config;
  if (!patch || typeof patch !== 'object') return c;

  if (typeof patch.masterEnabled === 'boolean') c.masterEnabled = patch.masterEnabled;

  if (patch.persona) {
    const p = pick(patch.persona, PERSONA_KEYS);
    if (p && p.name) c.persona = p;
  }
  if (patch.bossProfile) {
    const b = pick(patch.bossProfile, BOSS_KEYS);
    if (b && b.bossTitle !== undefined) c.bossProfile = b;
  }

  if (patch.channels && typeof patch.channels === 'object') {
    for (const id of CHANNEL_IDS) {
      const p = patch.channels[id];
      if (!p || typeof p !== 'object') continue;
      if (p.mode === 'off' || p.mode === 'draft' || p.mode === 'auto') c.channels[id].mode = p.mode;
      const cta = str(p.ctaOverride, 300);
      if (cta !== undefined) c.channels[id].ctaOverride = cta;
    }
  }

  if (patch.youtube) {
    const cid = str(patch.youtube.channelId, 64);
    if (cid !== undefined && /^[A-Za-z0-9_-]*$/.test(cid)) c.youtube.channelId = cid;
    const pm = num(patch.youtube.pollMinutes, 2, 60);
    if (pm !== undefined) c.youtube.pollMinutes = pm;
  }

  if (patch.web) {
    if (Array.isArray(patch.web.allowedOrigins)) {
      const origins: string[] = [];
      for (const o of patch.web.allowedOrigins.slice(0, 20)) {
        if (typeof o !== 'string') continue;
        const t = o.trim();
        if (t === '*') origins.push('*');
        else {
          try {
            const u = new URL(t);
            if (u.protocol === 'https:' || u.protocol === 'http:') origins.push(u.origin);
          } catch {
            /* 無効なURLは無視 */
          }
        }
      }
      c.web.allowedOrigins = [...new Set(origins)];
    }
    const hm = str(patch.web.holdingMessage, 300);
    if (hm) c.web.holdingMessage = hm;
  }

  if (patch.limits) {
    const a = num(patch.limits.perSenderPerHour, 1, 100);
    const b = num(patch.limits.globalPerHour, 1, 2000);
    if (a !== undefined) c.limits.perSenderPerHour = a;
    if (b !== undefined) c.limits.globalPerHour = b;
  }

  if (patch.disclosure) {
    if (typeof patch.disclosure.enabled === 'boolean') c.disclosure.enabled = patch.disclosure.enabled;
    const t = str(patch.disclosure.text, 100);
    if (t !== undefined) c.disclosure.text = t;
  }

  if (Array.isArray(patch.handoffKeywords)) {
    c.handoffKeywords = patch.handoffKeywords
      .filter((k: unknown): k is string => typeof k === 'string')
      .map((k: string) => k.trim().slice(0, 30))
      .filter(Boolean)
      .slice(0, 50);
  }

  if (typeof patch.notifyWebhookUrl === 'string') {
    const u = patch.notifyWebhookUrl.trim();
    if (u === '' || isSafeWebhookUrl(u)) c.notifyWebhookUrl = u;
  }
  if (patch.lineNotify && typeof patch.lineNotify === 'object') {
    if (typeof patch.lineNotify.enabled === 'boolean') c.lineNotify.enabled = patch.lineNotify.enabled;
    if (Array.isArray(patch.lineNotify.userIds)) {
      c.lineNotify.userIds = [
        ...new Set<string>(
          patch.lineNotify.userIds
            .filter((v: unknown): v is string => typeof v === 'string')
            .map((v: string) => v.trim())
            .filter((v: string) => isLineUserId(v))
        ),
      ].slice(0, 5);
    }
  }

  if (typeof patch.sheetWebhookUrl === 'string') {
    const u = patch.sheetWebhookUrl.trim();
    if (u === '' || isSafeWebhookUrl(u)) c.sheetWebhookUrl = u;
  }

  const lt = num(patch.leadScoreThreshold, 0, 100);
  if (lt !== undefined) c.leadScoreThreshold = lt;

  c.updatedAt = new Date().toISOString();
  scheduleSave();
  return c;
}

// ---------- secrets ----------

export function getApiKey(): string {
  if (process.env.INBOUND_API_KEY) return process.env.INBOUND_API_KEY;
  const d = load();
  if (!d.secrets.apiKey) {
    d.secrets.apiKey = 'lga_' + rand(24);
    scheduleSave();
  }
  return d.secrets.apiKey;
}

export function rotateApiKey(): string {
  const d = load();
  d.secrets.apiKey = 'lga_' + rand(24);
  scheduleSave();
  return getApiKey();
}

export function rotateSiteKey(): string {
  const c = load().config;
  c.web.siteKey = 'pk_' + rand(12);
  scheduleSave();
  return c.web.siteKey;
}

// ---------- inbox log ----------

export const newId = () => 'm_' + Date.now().toString(36) + rand(4);

export function saveEntry(e: Entry) {
  const d = load();
  const i = d.log.findIndex((x) => x.id === e.id);
  if (i >= 0) d.log[i] = e;
  else d.log.push(e);
  if (d.log.length > MAX_LOG) d.log.splice(0, d.log.length - MAX_LOG);
  scheduleSave();
}

export function getEntry(id: string): Entry | undefined {
  return load().log.find((x) => x.id === id);
}

export function listEntries(opts: { status?: string; channel?: string; limit?: number } = {}): Entry[] {
  const out: Entry[] = [];
  const log = load().log;
  for (let i = log.length - 1; i >= 0 && out.length < (opts.limit ?? 100); i--) {
    const e = log[i];
    if (opts.status && e.status !== opts.status) continue;
    if (opts.channel && e.channel !== opts.channel) continue;
    out.push(e);
  }
  return out;
}

export function stats(sinceMs = 7 * 24 * 3600 * 1000) {
  const since = Date.now() - sinceMs;
  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  let leads = 0;
  const thr = getConfig().leadScoreThreshold;
  for (const e of load().log) {
    if (Date.parse(e.createdAt) < since) continue;
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
    if ((e.leadScore ?? 0) >= thr) leads++;
  }
  const pending = load().log.filter((e) => e.status === 'drafted' || e.status === 'needs_human').length;
  return { byStatus, byChannel, leads, pending };
}

// ---------- dedupe ----------

/** 初見なら true を返して記録、既知なら false */
export function markSeen(key: string): boolean {
  const d = load();
  if (d.seen.includes(key)) return false;
  d.seen.push(key);
  if (d.seen.length > MAX_SEEN) d.seen.splice(0, d.seen.length - MAX_SEEN);
  scheduleSave();
  return true;
}

// ---------- conversation history ----------

export function getHistory(key: string): Msg[] {
  return load().convos[key] || [];
}

export function addHistory(key: string, m: Msg) {
  const d = load();
  const arr = (d.convos[key] ||= []);
  arr.push({ sender: m.sender, text: m.text.slice(0, 1500) });
  if (arr.length > MAX_MSGS_PER_CONVO) arr.splice(0, arr.length - MAX_MSGS_PER_CONVO);
  const keys = Object.keys(d.convos);
  if (keys.length > MAX_CONVOS) for (const k of keys.slice(0, keys.length - MAX_CONVOS)) delete d.convos[k];
  scheduleSave();
}

// ---------- tokens / kv ----------

export const getToken = (name: string): TokenRec | undefined => load().tokens[name];
export function setToken(name: string, t: TokenRec) {
  load().tokens[name] = t;
  scheduleSave();
}

export const getKv = (k: string): string | undefined => load().kv[k];
export function setKv(k: string, v: string) {
  load().kv[k] = v;
  scheduleSave();
}
