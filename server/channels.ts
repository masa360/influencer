import type { ChannelId, Entry, Kind, Source } from './store.ts';
import { getConfig } from './store.ts';
import { clipBytes, clipChars, httpJson, verifyHmac } from './util.ts';
import { getGoogleAccessToken } from './tokens.ts';

/** 各チャンネルのWebhook/ポーリングから生成される「受信メッセージ」 */
export interface Inbound {
  channel: ChannelId;
  kind: Kind;
  /** 重複排除用ID（プラットフォームのイベント/メッセージID）。空なら重複排除しない */
  eventId?: string;
  senderId: string;
  senderName?: string;
  email?: string;
  text: string;
  ref: Record<string, string>;
  source?: Source;
  viaApi?: boolean;
}

const env = (k: string) => process.env[k];

// ---------------------------------------------------------------------------
// 認証情報の有無（値そのものはUIに出さない）
// ---------------------------------------------------------------------------

export function credentialStatus(): Record<ChannelId | 'gemini', { configured: boolean; missing: string[] }> {
  const miss = (names: string[]) => names.filter((n) => !env(n));
  const mk = (missing: string[]) => ({ configured: missing.length === 0, missing });
  const igToken = env('META_IG_ACCESS_TOKEN') || env('META_PAGE_ACCESS_TOKEN') ? [] : ['META_PAGE_ACCESS_TOKEN'];
  const cfg = getConfig();
  return {
    gemini: mk(miss(['GEMINI_API_KEY'])),
    instagram: mk([...miss(['META_APP_SECRET', 'META_VERIFY_TOKEN']), ...igToken]),
    facebook: mk(miss(['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN'])),
    youtube: mk([
      ...miss(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']),
      ...(cfg.youtube.channelId ? [] : ['YouTubeチャンネルID（設定画面）']),
    ]),
    line: mk(miss(['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'])),
    web: mk(cfg.web.allowedOrigins.length ? [] : ['許可オリジン（設定画面）']),
  };
}

// ---------------------------------------------------------------------------
// Meta (Instagram / Facebook Messenger / Facebook Page comments)
// ---------------------------------------------------------------------------

export function verifyMeta(raw: string, sig: string | undefined) {
  return verifyHmac(env('META_APP_SECRET'), raw, sig, 'hex', 'sha256=');
}

export function parseMeta(body: any): Inbound[] {
  const out: Inbound[] = [];
  const channel: ChannelId | null = body?.object === 'instagram' ? 'instagram' : body?.object === 'page' ? 'facebook' : null;
  if (!channel) return out;

  for (const entry of body.entry || []) {
    const selfId = String(entry.id || '');

    for (const m of entry.messaging || []) {
      const text = m?.message?.text;
      if (!text || m.message.is_echo) continue; // エコー（自分の送信）は無視
      const sender = String(m.sender?.id || '');
      if (!sender || sender === selfId) continue;
      out.push({
        channel,
        kind: 'dm',
        eventId: m.message.mid,
        senderId: sender,
        text,
        ref: {},
        source: { type: 'webhook' },
      });
    }

    for (const c of entry.changes || []) {
      const v = c?.value;
      if (!v) continue;
      if (channel === 'instagram' && c.field === 'comments') {
        if (!v.id || !v.text || v.parent_id) continue; // 返信コメント(スレッド内)には反応しない
        if (String(v.from?.id) === selfId) continue;
        out.push({
          channel,
          kind: 'comment',
          eventId: 'igc_' + v.id,
          senderId: String(v.from?.id || v.from?.username || ''),
          senderName: v.from?.username,
          text: v.text,
          ref: { commentId: String(v.id), mediaId: String(v.media?.id || '') },
          source: { type: 'webhook' },
        });
      }
      if (channel === 'facebook' && c.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
        if (!v.comment_id || !v.message) continue;
        if (v.parent_id && v.post_id && v.parent_id !== v.post_id) continue; // トップレベルのコメントのみ
        if (String(v.from?.id) === selfId) continue;
        out.push({
          channel,
          kind: 'comment',
          eventId: 'fbc_' + v.comment_id,
          senderId: String(v.from?.id || ''),
          senderName: v.from?.name,
          text: v.message,
          ref: { commentId: String(v.comment_id), postId: String(v.post_id || '') },
          source: { type: 'webhook' },
        });
      }
    }
  }
  return out;
}

async function sendMeta(e: Entry, text: string) {
  const ver = env('META_GRAPH_VERSION') || 'v21.0';
  const token = e.channel === 'instagram' ? env('META_IG_ACCESS_TOKEN') || env('META_PAGE_ACCESS_TOKEN') : env('META_PAGE_ACCESS_TOKEN');
  if (!token) throw new Error('Meta のアクセストークンが未設定です');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const g = `https://graph.facebook.com/${ver}`;

  if (e.kind === 'dm') {
    // InstagramのDMは1000バイト上限（日本語は1文字3バイト）
    const body = e.channel === 'instagram' ? clipBytes(text, 1000) : clipChars(text, 1900);
    await httpJson(`${g}/me/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipient: { id: e.senderId }, messaging_type: 'RESPONSE', message: { text: body } }),
    });
  } else if (e.channel === 'instagram') {
    await httpJson(`${g}/${encodeURIComponent(e.ref.commentId)}/replies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: clipChars(text, 2000) }),
    });
  } else {
    await httpJson(`${g}/${encodeURIComponent(e.ref.commentId)}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: clipChars(text, 2000) }),
    });
  }
}

// ---------------------------------------------------------------------------
// LINE Messaging API
// ---------------------------------------------------------------------------

export function verifyLine(raw: string, sig: string | undefined) {
  return verifyHmac(env('LINE_CHANNEL_SECRET'), raw, sig, 'base64');
}

export function parseLine(body: any): Inbound[] {
  const out: Inbound[] = [];
  for (const ev of body?.events || []) {
    if (ev?.type !== 'message' || ev.message?.type !== 'text') continue;
    const userId = ev.source?.userId;
    if (!userId) continue;
    out.push({
      channel: 'line',
      kind: 'dm',
      eventId: ev.webhookEventId || ev.message.id,
      senderId: userId,
      text: ev.message.text,
      ref: { replyToken: ev.replyToken || '', receivedAt: String(ev.timestamp || Date.now()) },
      source: { type: 'webhook' },
    });
  }
  return out;
}

async function sendLine(e: Entry, text: string) {
  const token = env('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const messages = [{ type: 'text', text: clipChars(text, 4500) }];
  // replyToken は短時間しか使えない。古い場合（承認後の送信など）は push に切り替える
  const fresh = e.ref.replyToken && Date.now() - Number(e.ref.receivedAt || 0) < 25_000;
  if (fresh) {
    await httpJson('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers,
      body: JSON.stringify({ replyToken: e.ref.replyToken, messages }),
    });
  } else {
    await httpJson('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: e.senderId, messages }),
    });
  }
}

// ---------------------------------------------------------------------------
// YouTube (コメントへの返信。受信はポーリング: youtube.ts)
// ---------------------------------------------------------------------------

async function sendYouTube(e: Entry, text: string) {
  const token = await getGoogleAccessToken();
  await httpJson('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { parentId: e.ref.parentId, textOriginal: clipChars(text, 1000) } }),
  });
}

// ---------------------------------------------------------------------------
// LP / HP: メール返信（フォーム経由で email がある場合のみ。Resend API）
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function sendWebEmail(e: Entry, text: string) {
  if (!e.email || !EMAIL_RE.test(e.email)) return;
  const key = env('RESEND_API_KEY');
  const from = env('MAIL_FROM');
  if (!key || !from) return; // 未設定ならメール送信はスキップ（APIレスポンスとして返却のみ）
  await httpJson('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [e.email],
      subject: env('MAIL_SUBJECT') || 'お問い合わせありがとうございます',
      text,
    }),
  });
}

// ---------------------------------------------------------------------------

export async function sendReply(e: Entry, text: string): Promise<void> {
  switch (e.channel) {
    case 'instagram':
    case 'facebook':
      return sendMeta(e, text);
    case 'youtube':
      return sendYouTube(e, text);
    case 'line':
      return sendLine(e, text);
    case 'web':
      return sendWebEmail(e, text);
  }
}
