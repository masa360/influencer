import type { Inbound } from './channels.ts';
import { pushLineToOwners, sendReply } from './channels.ts';
import { generateReply, type Intent } from './agent.ts';
import {
  addHistory,
  getConfig,
  getEntry,
  getHistory,
  isSafeWebhookUrl,
  markSeen,
  newId,
  saveEntry,
  type ChannelId,
  type Config,
  type Entry,
  type Kind,
  type Msg,
} from './store.ts';
import { cleanInput, envValue, httpJson, tryConsume } from './util.ts';

/** 人間対応キーワードに一致したものを返す（なければ undefined） */
export function findHandoffKeyword(cfg: Config, text: string): string | undefined {
  const lower = text.toLowerCase();
  return cfg.handoffKeywords.find((k) => k && lower.includes(k.toLowerCase()));
}

/** 設定に応じて「AIによる自動返信です」の明示文を付ける（コメント返信と初回メッセージのみ） */
export function withDisclosure(cfg: Config, kind: Kind, isFirstReply: boolean, reply: string): string {
  if (cfg.disclosure.enabled && cfg.disclosure.text && (kind === 'comment' || isFirstReply)) {
    return `${reply}\n${cfg.disclosure.text}`;
  }
  return reply;
}

export interface PreviewResult {
  /** reply: 返信する / needs_human: 人間に回す / skipped: 返信しない（スパム等） */
  status: 'reply' | 'needs_human' | 'skipped';
  reply: string;
  intent: Intent | null;
  leadScore: number | null;
  note: string;
}

/**
 * 本番と同じ判定・プロンプトで返信案を作る（保存・送信・通知はしない）。
 * DM誘導シミュレーターや管理画面の「返信プレビュー」で使う。
 *
 * @example
 * const r = await previewReply({ channel: 'line', kind: 'dm', message: '相談したい', history: [], config: getConfig() });
 * // r.status === 'reply' なら r.reply が実際に送られる文面
 */
export async function previewReply(args: {
  channel: ChannelId;
  kind: Kind;
  message: string;
  history: Msg[];
  config: Config;
}): Promise<PreviewResult> {
  const { config: cfg, kind } = args;
  const text = cleanInput(args.message);
  const hit = findHandoffKeyword(cfg, text);
  if (hit) {
    return { status: 'needs_human', reply: '', intent: null, leadScore: null, note: `人間対応キーワード「${hit}」を含むため、AIは返信せずあなたに回します` };
  }
  const isFirstReply = !args.history.some((m) => m.sender === 'influencer');
  const r = await generateReply({ channel: args.channel, kind, message: text, history: args.history, isFirstReply, config: cfg });
  if (!r.shouldReply) return { status: 'skipped', reply: '', intent: r.intent, leadScore: r.leadScore, note: `返信不要と判断（${r.intent}）` };
  const reply = withDisclosure(cfg, kind, isFirstReply, r.reply);
  if (r.needsHuman) return { status: 'needs_human', reply, intent: r.intent, leadScore: r.leadScore, note: 'AIが人間対応を推奨（本番では自動送信せず、あなたに通知します）' };
  return { status: 'reply', reply, intent: r.intent, leadScore: r.leadScore, note: '' };
}

/**
 * すべての受信（SNS/YouTube/LP/HP/API）が通る共通処理。
 *
 *  無効/重複/空 → 破棄
 *  → 人間対応キーワード → needs_human
 *  → レート制限 → skipped
 *  → Gemini生成 → (スパム/要人間対応/下書き/自動送信)
 *
 * 戻り値の Entry.status:
 *  sent / drafted / needs_human / skipped / error
 * 無効・重複・空のものは保存せず note に理由を入れて skipped で返す。
 */
export async function processInbound(inb: Inbound): Promise<Entry> {
  const cfg = getConfig();
  const chCfg = cfg.channels[inb.channel];
  const text = cleanInput(inb.text);

  const entry: Entry = {
    id: newId(),
    createdAt: new Date().toISOString(),
    channel: inb.channel,
    kind: inb.kind,
    senderId: String(inb.senderId),
    senderName: inb.senderName,
    email: inb.email,
    text,
    status: 'skipped',
    ref: inb.ref,
    source: inb.source,
    viaApi: inb.viaApi,
    conversationKey: `${inb.channel}:${inb.senderId}`,
  };

  if (!cfg.masterEnabled || chCfg.mode === 'off') return { ...entry, note: 'disabled' };
  if (!text) return { ...entry, note: 'empty' };
  if (inb.eventId && !markSeen(`${inb.channel}:${inb.eventId}`)) return { ...entry, note: 'duplicate' };

  // ここから先は受信ログに残す
  const finish = (patch: Partial<Entry>): Entry => {
    Object.assign(entry, patch);
    saveEntry(entry);
    void notifyIfNeeded(entry);
    void logToSheet(entry);
    return entry;
  };

  // 人間対応キーワード（モデルを呼ぶ前に判定）
  const hit = findHandoffKeyword(cfg, text);
  if (hit) return finish({ status: 'needs_human', note: `人間対応キーワード: ${hit}` });

  // 送信者ごと/全体のレート制限（広告費ならぬAPI費の暴走防止）
  const ok = tryConsume(
    [
      { key: 's:' + entry.conversationKey, max: cfg.limits.perSenderPerHour },
      { key: 'global', max: cfg.limits.globalPerHour },
    ],
    3_600_000
  );
  if (!ok) return finish({ status: 'skipped', note: 'rate_limited' });

  const history = getHistory(entry.conversationKey);
  const isFirstReply = !history.some((m) => m.sender === 'influencer');
  addHistory(entry.conversationKey, { sender: 'prospect', text });

  let result;
  try {
    result = await generateReply({
      channel: inb.channel,
      kind: inb.kind,
      message: text,
      senderName: inb.senderName,
      history,
      isFirstReply,
      pageContext: inb.source?.page,
      config: cfg,
    });
  } catch (err) {
    return finish({ status: 'error', note: (err as Error).message });
  }

  entry.intent = result.intent;
  entry.leadScore = result.leadScore;

  if (!result.shouldReply) return finish({ status: 'skipped', note: `返信不要 (${result.intent})` });

  const reply = withDisclosure(cfg, inb.kind, isFirstReply, result.reply);
  entry.reply = reply;

  if (result.needsHuman) return finish({ status: 'needs_human', note: 'AIが人間対応を推奨' });
  if (chCfg.mode === 'draft') return finish({ status: 'drafted' });

  // mode === 'auto'
  // - API経由: 呼び出し側が配信するのでレスポンスとして返すだけ
  // - Webウィジェット: チャット画面にレスポンスを表示するだけ
  const returnedToCaller = inb.viaApi || (inb.channel === 'web' && inb.source?.type === 'widget');
  if (!returnedToCaller) {
    try {
      await sendReply(entry, reply);
    } catch (err) {
      return finish({ status: 'error', note: `送信失敗: ${(err as Error).message}` });
    }
  }
  addHistory(entry.conversationKey, { sender: 'influencer', text: reply });
  return finish({ status: 'sent', note: returnedToCaller ? 'レスポンスとして返却' : undefined });
}

/** 下書き / 要人間対応 / エラー の受信を、編集した本文（任意）で送信する */
export async function approveEntry(id: string, replyOverride?: string): Promise<Entry> {
  const e = getEntry(id);
  if (!e) throw new HttpError(404, 'not_found');
  if (!['drafted', 'needs_human', 'error'].includes(e.status)) throw new HttpError(409, `status=${e.status} は送信できません`);
  const text = cleanInput(replyOverride ?? e.reply ?? '', 5000);
  if (!text) throw new HttpError(400, '返信本文が空です');

  if (!e.viaApi) {
    try {
      await sendReply(e, text);
    } catch (err) {
      e.note = `送信失敗: ${(err as Error).message}`;
      saveEntry(e);
      throw new HttpError(502, e.note);
    }
  }
  e.reply = text;
  e.status = 'sent';
  e.note = e.viaApi ? '承認済み（API経由のため配信は呼び出し側）' : '承認して送信';
  addHistory(e.conversationKey, { sender: 'influencer', text });
  saveEntry(e);
  void logToSheet(e);
  return e;
}

export function rejectEntry(id: string): Entry {
  const e = getEntry(id);
  if (!e) throw new HttpError(404, 'not_found');
  if (!['drafted', 'needs_human', 'error'].includes(e.status)) throw new HttpError(409, `status=${e.status} は却下できません`);
  e.status = 'rejected';
  saveEntry(e);
  void logToSheet(e);
  return e;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** エラー通知の間隔（同じ障害で通知が連続しないように） */
const ERROR_NOTIFY_WINDOW_MS = 30 * 60_000;

/**
 * 通知の対象か。
 * - 要人間対応
 * - 見込み度が閾値以上
 * - 返信エラー（Gemini障害・送信失敗など。見込み客が放置されるため。30分に1回まで）
 */
function shouldNotify(e: Entry): boolean {
  const cfg = getConfig();
  if (e.status === 'needs_human') return true;
  if (e.status === 'error') return tryConsume([{ key: 'notify-error', max: 1 }], ERROR_NOTIFY_WINDOW_MS);
  return (e.leadScore ?? 0) >= cfg.leadScoreThreshold && e.status !== 'skipped';
}

/** 通知本文（LINE・Slack・Discord 共通） */
export function buildNotifyText(e: Entry): string {
  const label =
    e.status === 'error'
      ? `⚠️ 返信エラー（見込み客に返信できていません）\n理由：${(e.note || '不明').slice(0, 150)}\n※ 同様のエラーは30分間通知しません`
      : e.status === 'needs_human'
        ? '🙋 要人間対応'
        : `🔥 見込み客（スコア${e.leadScore}）`;
  const appUrl = envValue('APP_URL').replace(/\/$/, '');
  return [
    `${label}`,
    `[${e.channel}] ${e.senderName || e.senderId}`,
    `「${e.text.slice(0, 200)}」`,
    e.reply ? `\n返信案：${e.reply.slice(0, 200)}` : '',
    appUrl ? `\n受信ログで確認 → ${appUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 高スコアのリード/要人間対応を通知する（任意）。
 * - 運営者のLINE（設定「LINE通知」）
 * - 通知先Webhook（Slack / Discord など）
 */
async function notifyIfNeeded(e: Entry) {
  if (!shouldNotify(e)) return;
  const cfg = getConfig();
  const text = buildNotifyText(e);

  if (cfg.lineNotify.enabled && cfg.lineNotify.userIds.length) {
    try {
      await pushLineToOwners(cfg.lineNotify.userIds, text);
    } catch (err) {
      console.warn('[notify:line] failed:', (err as Error).message);
    }
  }

  const url = cfg.notifyWebhookUrl;
  if (!url || !isSafeWebhookUrl(url)) return;
  try {
    await httpJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Slack(text) / Discord(content) / その他(その他のフィールド) 共用
        body: JSON.stringify({ text, content: text, ...entryPayload(e) }),
      },
      5000
    );
  } catch (err) {
    console.warn('[notify] failed:', (err as Error).message);
  }
}

/** Webhookに送る受信1件分のデータ */
export function entryPayload(e: Entry) {
  return {
    id: e.id,
    createdAt: e.createdAt,
    updatedAt: new Date().toISOString(),
    channel: e.channel,
    kind: e.kind,
    status: e.status,
    leadScore: e.leadScore ?? null,
    intent: e.intent ?? null,
    sender: { id: e.senderId, name: e.senderName ?? '', email: e.email ?? '' },
    message: e.text,
    reply: e.reply ?? '',
    note: e.note ?? '',
    source: e.source ?? {},
  };
}

/**
 * 受信1件を記録用Webhook（Google Apps Script など）へ送る。
 * 同じ id で何度も送られる（受信時・承認時・却下時）ので、受け側は id で上書き更新する。
 * 受け側のサンプルは gas/Code.gs を参照。
 *
 * @example
 * // 設定「記録用Webhook URL」に GAS のウェブアプリURL（?key=合言葉 付き）を入れると有効になる
 */
export async function logToSheet(e: Entry): Promise<void> {
  const url = getConfig().sheetWebhookUrl;
  if (!url || !isSafeWebhookUrl(url)) return;
  try {
    await httpJson(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entryPayload(e)) },
      10_000
    );
  } catch (err) {
    console.warn('[sheet] failed:', (err as Error).message);
  }
}
