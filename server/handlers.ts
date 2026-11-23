import {
  CHANNEL_IDS,
  getApiKey,
  getConfig,
  listEntries,
  rotateApiKey,
  rotateSiteKey,
  stats,
  updateConfig,
  type ChannelId,
  type Kind,
} from './store.ts';
import {
  credentialStatus,
  parseLine,
  parseMeta,
  verifyLine,
  verifyMeta,
  type Inbound,
} from './channels.ts';
import { approveEntry, HttpError, processInbound, rejectEntry } from './pipeline.ts';
import { generateReply } from './agent.ts';
import { pollYouTubeOnce } from './youtube.ts';
import { WIDGET_JS } from './widget.ts';
import { cleanInput, safeEqual, tryConsume } from './util.ts';

export interface Req {
  method: string;
  headers: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: any;
  rawBody: string;
  /** クライアントIP（レート制限用） */
  ip: string;
  /** ソケットの接続元（管理APIのloopback判定用。X-Forwarded-For に影響されない） */
  remote: string;
  params: Record<string, string>;
  /** 外部から見えるこのアプリのURL（Webhook URL表示用） */
  baseUrl: string;
}

export interface Res {
  status: number;
  body?: unknown;
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

export type Handler = (req: Req) => Promise<Res> | Res;

const ok = (body: unknown = { ok: true }, status = 200): Res => ({ status, body });
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Res => ({
  status,
  body: { ok: false, error, ...extra },
});
const q = (v: unknown) => (typeof v === 'string' ? v : '');

/** Webhookは即200を返し、処理はバックグラウンドで行う（各プラットフォームのタイムアウト対策） */
function background(items: Inbound[]) {
  void (async () => {
    for (const it of items) {
      try {
        await processInbound(it);
      } catch (e) {
        console.error('[inbound] failed:', (e as Error).message);
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const metaWebhookGet: Handler = (req) => {
  const verify = process.env.META_VERIFY_TOKEN;
  if (verify && q(req.query['hub.mode']) === 'subscribe' && safeEqual(q(req.query['hub.verify_token']), verify)) {
    return { status: 200, text: q(req.query['hub.challenge']), contentType: 'text/plain' };
  }
  return err(403, 'verify_failed');
};

export const metaWebhookPost: Handler = (req) => {
  if (!verifyMeta(req.rawBody, req.headers['x-hub-signature-256'])) return err(401, 'invalid_signature');
  background(parseMeta(req.body));
  return ok();
};

export const lineWebhookPost: Handler = (req) => {
  if (!verifyLine(req.rawBody, req.headers['x-line-signature'])) return err(401, 'invalid_signature');
  background(parseLine(req.body));
  return ok();
};

// ---------------------------------------------------------------------------
// LP / HP 用の公開エンドポイント（ウィジェット・フォーム）
// ---------------------------------------------------------------------------

function corsFor(origin: string | undefined): Record<string, string> | null {
  const allowed = getConfig().web.allowedOrigins;
  if (!allowed.length) return null;
  if (allowed.includes('*')) return { 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
  if (origin && allowed.includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return null;
}

const CORS_COMMON = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
};

export const webInbound: Handler = async (req) => {
  const origin = req.headers['origin'];
  const cors = corsFor(origin);
  const withCors = (r: Res): Res => ({ ...r, headers: { ...(cors || {}), ...CORS_COMMON, ...(r.headers || {}) } });

  if (req.method === 'OPTIONS') return withCors({ status: cors ? 204 : 403 });
  if (!cors) return err(403, 'origin_not_allowed'); // 許可オリジン未設定 or 不一致

  const b = req.body || {};
  const cfg = getConfig();
  if (typeof b.siteKey !== 'string' || !safeEqual(b.siteKey, cfg.web.siteKey)) return withCors(err(401, 'invalid_site_key'));

  const sessionId = typeof b.sessionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.sessionId) ? b.sessionId : '';
  const message = cleanInput(b.message, 1000);
  if (!sessionId || !message) return withCors(err(400, 'invalid_request'));

  // IP単位の簡易レート制限（1分20回）
  if (!tryConsume([{ key: 'web-ip:' + req.ip, max: 20 }], 60_000)) {
    return withCors(err(429, 'too_many_requests', { reply: '短時間にメッセージが集中しています。少し時間をおいてお試しください。' }));
  }

  const type = b.type === 'form' ? 'form' : 'widget';
  const utm: Record<string, string> = {};
  if (b.utm && typeof b.utm === 'object') {
    for (const [k, v] of Object.entries(b.utm).slice(0, 10)) if (typeof v === 'string') utm[k.slice(0, 30)] = v.slice(0, 100);
  }

  const entry = await processInbound({
    channel: 'web',
    kind: 'web',
    senderId: 'web:' + sessionId,
    senderName: typeof b.name === 'string' ? cleanInput(b.name, 80) : undefined,
    email: typeof b.email === 'string' ? cleanInput(b.email, 200) : undefined,
    text: message,
    ref: {},
    source: { type, page: typeof b.page === 'string' ? b.page.slice(0, 500) : undefined, utm },
  });

  // 公開レスポンスには内部情報（意図・スコア等）を含めない
  switch (entry.status) {
    case 'sent':
      return withCors(ok({ ok: true, reply: entry.reply }));
    case 'drafted':
    case 'needs_human':
      return withCors(ok({ ok: true, queued: true, reply: cfg.web.holdingMessage }));
    case 'error':
      return withCors(err(502, 'unavailable', { reply: '申し訳ありません、ただいま応答できません。時間をおいてもう一度お試しください。' }));
    default:
      if (entry.note === 'rate_limited') {
        return withCors(err(429, 'too_many_requests', { reply: '短時間にメッセージが集中しています。少し時間をおいてお試しください。' }));
      }
      if (entry.note === 'disabled') return withCors(err(503, 'disabled'));
      return withCors(ok({ ok: true, queued: true, reply: cfg.web.holdingMessage }));
  }
};

export const widgetJs: Handler = () => ({
  status: 200,
  text: WIDGET_JS,
  contentType: 'application/javascript; charset=utf-8',
  headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
});

// ---------------------------------------------------------------------------
// サーバー間API: POST /api/v1/reply  (Authorization: Bearer <API key>)
// Make / Zapier / n8n / 自社フォーム / 各種SNS連携ツールから呼ぶ想定
// ---------------------------------------------------------------------------

const API_CHANNEL_ALIASES: Record<string, ChannelId> = { lp: 'web', hp: 'web', form: 'web', site: 'web', website: 'web' };

function bearer(req: Req): string {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export const apiReply: Handler = async (req) => {
  const key = bearer(req);
  if (!key || !safeEqual(key, getApiKey())) return err(401, 'unauthorized');
  if (!tryConsume([{ key: 'api-ip:' + req.ip, max: 120 }], 60_000)) return err(429, 'too_many_requests');

  const b = req.body || {};
  const raw = typeof b.channel === 'string' ? b.channel.toLowerCase() : 'web';
  const channel = (API_CHANNEL_ALIASES[raw] || raw) as ChannelId;
  if (!CHANNEL_IDS.includes(channel)) return err(400, 'invalid_channel', { allowed: [...CHANNEL_IDS, ...Object.keys(API_CHANNEL_ALIASES)] });
  const message = cleanInput(b.message, 2000);
  if (!message) return err(400, 'message_required');

  const sender = b.sender && typeof b.sender === 'object' ? b.sender : {};
  const senderId = cleanInput(sender.id ?? b.conversationId ?? sender.email, 120) || 'api-anonymous';
  const kind: Kind = b.kind === 'comment' ? 'comment' : channel === 'web' ? 'web' : 'dm';

  const entry = await processInbound({
    channel,
    kind,
    eventId: typeof b.eventId === 'string' ? b.eventId.slice(0, 120) : undefined, // 指定すれば重複排除される
    senderId,
    senderName: typeof sender.name === 'string' ? cleanInput(sender.name, 80) : undefined,
    email: typeof sender.email === 'string' ? cleanInput(sender.email, 200) : undefined,
    text: message,
    ref: {},
    viaApi: true,
    source: { type: 'api', page: typeof b.page === 'string' ? b.page.slice(0, 500) : undefined },
  });

  if (entry.note === 'disabled') return err(409, 'channel_disabled', { status: 'skipped' });
  if (entry.note === 'duplicate') return ok({ ok: true, status: 'skipped', note: 'duplicate' });
  return ok({
    ok: entry.status !== 'error',
    id: entry.id,
    status: entry.status,
    reply: entry.reply ?? null,
    intent: entry.intent ?? null,
    leadScore: entry.leadScore ?? null,
    needsHuman: entry.status === 'needs_human',
    note: entry.note ?? null,
  });
};

// ---------------------------------------------------------------------------
// 管理API（設定UI用）
// ---------------------------------------------------------------------------

function isLoopback(addr: string) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** 認証OKなら null、NGならエラーレスポンス */
export function adminGuard(req: Req): Res | null {
  const token = process.env.ADMIN_TOKEN;
  if (token) {
    const given = bearer(req);
    return given && safeEqual(given, token) ? null : err(401, 'unauthorized');
  }
  // ADMIN_TOKEN 未設定: 開発中（非production）のローカル接続のみ許可
  if (process.env.NODE_ENV !== 'production' && isLoopback(req.remote)) return null;
  return err(503, 'admin_token_not_configured', {
    message: '本番では環境変数 ADMIN_TOKEN を設定してください。',
  });
}

function guarded(h: Handler): Handler {
  return (req) => adminGuard(req) || h(req);
}

function state(req: Req) {
  const cfg = getConfig();
  const base = req.baseUrl.replace(/\/$/, '');
  return {
    config: cfg,
    credentials: credentialStatus(),
    urls: {
      meta: `${base}/webhooks/meta`,
      line: `${base}/webhooks/line`,
      widgetScript: `${base}/widget.js`,
      webInbound: `${base}/api/inbound/web`,
      api: `${base}/api/v1/reply`,
    },
    apiKey: getApiKey(),
    stats: stats(),
    adminProtected: !!process.env.ADMIN_TOKEN,
  };
}

export const adminGetState: Handler = guarded((req) => ok(state(req)));

export const adminPutConfig: Handler = guarded((req) => {
  updateConfig(req.body);
  return ok(state(req));
});

export const adminInbox: Handler = guarded((req) => {
  const limit = Math.min(200, Math.max(1, Number(q(req.query.limit)) || 100));
  return ok({ entries: listEntries({ status: q(req.query.status) || undefined, channel: q(req.query.channel) || undefined, limit }) });
});

export const adminApprove: Handler = guarded(async (req) => {
  try {
    const e = await approveEntry(req.params.id, typeof req.body?.reply === 'string' ? req.body.reply : undefined);
    return ok({ entry: e });
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    throw e;
  }
});

export const adminReject: Handler = guarded((req) => {
  try {
    return ok({ entry: rejectEntry(req.params.id) });
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    throw e;
  }
});

/** 送信せずに返信案だけ生成（UIの「返信プレビュー」） */
export const adminTestReply: Handler = guarded(async (req) => {
  const channel = req.body?.channel as ChannelId;
  if (!CHANNEL_IDS.includes(channel)) return err(400, 'invalid_channel');
  const message = cleanInput(req.body?.message, 1000);
  if (!message) return err(400, 'message_required');
  const kind: Kind = req.body?.kind === 'comment' ? 'comment' : channel === 'web' ? 'web' : 'dm';
  try {
    const r = await generateReply({ channel, kind, message, history: [], isFirstReply: true, config: getConfig() });
    return ok({ result: r });
  } catch (e) {
    return err(502, (e as Error).message);
  }
});

export const adminRotateKey: Handler = guarded((req) => {
  if (req.body?.which === 'site') rotateSiteKey();
  else rotateApiKey();
  return ok(state(req));
});

export const adminYoutubePoll: Handler = guarded(async () => {
  try {
    return ok({ result: await pollYouTubeOnce() });
  } catch (e) {
    return err(502, (e as Error).message);
  }
});
