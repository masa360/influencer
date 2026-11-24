import {
  addLineNotifyCount,
  CHANNEL_IDS,
  getAiCountToday,
  getLineNotifyCountMonth,
  isSafeWebhookUrl,
  newId,
  getApiKey,
  getConfig,
  getSheetKey,
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
  pushLineToOwners,
  replyLine,
  setupLineWebhook,
  parseLine,
  parseMeta,
  verifyLine,
  verifyMeta,
  type Inbound,
} from './channels.ts';
import { approveEntry, buildNotifyText, entryPayload, HttpError, previewReply, processInbound, rejectEntry, sheetUrlWithKey } from './pipeline.ts';
import { handleRegistration, isRegistrationMessage, issueRegistrationCode, REGISTRATION_REPLY } from './lineRegister.ts';
import fs from 'node:fs';
import { pollYouTubeOnce } from './youtube.ts';
import { WIDGET_JS } from './widget.ts';
import { cleanInput, envValue, httpJson, safeEqual, tryConsume } from './util.ts';

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
  const verify = envValue('META_VERIFY_TOKEN');
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
  const items = parseLine(req.body);
  // 「通知登録 123456」は運営者の通知先登録として処理し、AIの自動返信には回さない
  // （自動返信が停止中でも登録できるように、パイプラインより先に判定する）
  const normal: Inbound[] = [];
  for (const it of items) {
    if (isRegistrationMessage(it.text)) {
      const result = handleRegistration(it.text, it.senderId);
      console.log('[line] 通知先の登録:', result);
      if (it.ref.replyToken) {
        void replyLine(it.ref.replyToken, REGISTRATION_REPLY[result]).catch((e) => console.warn('[line] reply failed:', e.message));
      }
    } else {
      normal.push(it);
    }
  }
  background(normal);
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
  const token = envValue('ADMIN_TOKEN');
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
    // 上限ガードの使用状況（画面に表示）。cap が 0 のときは無制限
    usage: {
      aiToday: getAiCountToday(),
      aiCap: cfg.limits.aiPerDay,
      lineNotifyMonth: getLineNotifyCountMonth(),
      lineNotifyCap: cfg.lineNotify.monthlyCap,
    },
    adminProtected: !!envValue('ADMIN_TOKEN'),
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
    // 本番と同じ判定（人間対応キーワード・AI明示の付与）で返信案を作る
    const r = await previewReply({ channel, kind, message, history: [], config: getConfig() });
    return ok({
      result: { ...r, needsHuman: r.status === 'needs_human', shouldReply: r.status !== 'skipped' },
    });
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

/**
 * 「テスト送信」: 保存済みの LINE通知 / 記録用Webhook に、サンプル1件を実際に送って結果を返す。
 * 本番の通知はバックグラウンドで失敗を握りつぶすため、設定確認はこちらで行う。
 */
export const adminTestNotify: Handler = guarded(async () => {
  const cfg = getConfig();
  const now = new Date().toISOString();
  const sample = {
    id: 'test_' + newId(),
    createdAt: now,
    channel: 'line' as ChannelId,
    kind: 'dm' as Kind,
    senderId: 'test-user',
    senderName: 'テスト送信',
    text: 'これは設定確認用のテストです。',
    reply: '（テスト）返信案がここに入ります',
    intent: 'lead',
    leadScore: 99,
    status: 'drafted' as const,
    note: 'テスト送信',
    ref: {},
    conversationKey: 'test',
  };
  const result: Record<string, { ok: boolean; message: string }> = {};

  if (!cfg.lineNotify.enabled || !cfg.lineNotify.userIds.length) {
    result.line = { ok: false, message: 'LINE通知がオフ、またはユーザーIDが未設定です' };
  } else {
    try {
      await pushLineToOwners(cfg.lineNotify.userIds, '【テスト通知】\n' + buildNotifyText(sample));
      addLineNotifyCount(cfg.lineNotify.userIds.length); // テスト送信もLINEの通数に入る
      result.line = { ok: true, message: `${cfg.lineNotify.userIds.length}件のLINEに送信しました` };
    } catch (e) {
      result.line = { ok: false, message: (e as Error).message };
    }
  }

  const sheetUrl = sheetUrlWithKey(cfg.sheetWebhookUrl);
  if (!sheetUrl) {
    result.sheet = { ok: false, message: '記録用Webhook URLが未設定です' };
  } else {
    try {
      const r = await httpJson(
        sheetUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entryPayload(sample)) },
        10_000
      );
      // gas/Code.gs は { ok: true } / { ok: false, error } を返す
      if (r && typeof r === 'object' && r.ok === true) {
        result.sheet = { ok: true, message: 'スプレッドシートに記録しました（テスト行を確認してください）' };
      } else if (r && typeof r === 'object' && r.ok === false) {
        result.sheet = { ok: false, message: 'GAS側でエラー: ' + String(r.error || '不明') };
      } else {
        result.sheet = {
          ok: false,
          message: 'GASから想定外の応答でした。デプロイ時の「アクセスできるユーザー」が「全員」になっているか、URLが「/exec」で終わっているか確認してください',
        };
      }
    } catch (e) {
      const msg = (e as Error).message;
      result.sheet = {
        ok: false,
        message: /fetch failed|aborted|timeout/i.test(msg) ? 'GASのURLに接続できませんでした。URLが正しいか確認してください' : msg,
      };
    }
  }

  return ok({ result });
});

// ---------------------------------------------------------------------------
// 自動設定（手作業を減らすための管理API）
// ---------------------------------------------------------------------------

/** 「自分のLINEを通知先に登録」用の6桁コードを発行する（有効期限10分） */
export const adminLineRegisterCode: Handler = guarded(() => {
  if (!envValue('LINE_CHANNEL_ACCESS_TOKEN') || !envValue('LINE_CHANNEL_SECRET')) {
    return err(400, 'LINEの設定（LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN）が先に必要です');
  }
  return ok({ ok: true, ...issueRegistrationCode() });
});

/** LINE に Webhook URL を自動登録し、疎通テストまで行う */
export const adminLineSetupWebhook: Handler = guarded(async (req) => {
  if (!envValue('LINE_CHANNEL_ACCESS_TOKEN') || !envValue('LINE_CHANNEL_SECRET')) {
    return err(400, 'LINEの設定（LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN）が先に必要です');
  }
  const endpoint = `${req.baseUrl.replace(/\/$/, '')}/webhooks/line`;
  try {
    return ok({ result: await setupLineWebhook(endpoint) });
  } catch (e) {
    return err(502, (e as Error).message);
  }
});

/** GAS コードの置き場所（リポジトリの gas/Code.gs） */
const GAS_CODE_PATH = new URL('../gas/Code.gs', import.meta.url);

/**
 * 合言葉を書き込み済みの GAS コードを返す（画面の「GASコードをコピー」用）。
 * これをスプレッドシートの Apps Script に貼るだけでよく、合言葉を手で書く必要がない。
 */
export const adminGasCode: Handler = guarded(() => {
  let code: string;
  try {
    code = fs.readFileSync(GAS_CODE_PATH, 'utf8');
  } catch {
    return err(500, 'gas/Code.gs が見つかりません');
  }
  const key = getSheetKey();
  code = code.replace(/^const SECRET_KEY = '.*';.*$/m, `const SECRET_KEY = '${key}'; // アプリが自動で作った合言葉（変更しないでください）`);
  return { status: 200, text: code, contentType: 'text/plain; charset=utf-8' };
});
