import type { Inbound } from './channels.ts';
import { sendReply } from './channels.ts';
import { generateReply } from './agent.ts';
import {
  addHistory,
  getConfig,
  getEntry,
  getHistory,
  isSafeWebhookUrl,
  markSeen,
  newId,
  saveEntry,
  type Entry,
} from './store.ts';
import { cleanInput, httpJson, tryConsume } from './util.ts';

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
    return entry;
  };

  // 人間対応キーワード（モデルを呼ぶ前に判定）
  const lower = text.toLowerCase();
  const hit = cfg.handoffKeywords.find((k) => k && lower.includes(k.toLowerCase()));
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

  let reply = result.reply;
  if (cfg.disclosure.enabled && cfg.disclosure.text && (inb.kind === 'comment' || isFirstReply)) {
    reply = `${reply}\n${cfg.disclosure.text}`;
  }
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
  return e;
}

export function rejectEntry(id: string): Entry {
  const e = getEntry(id);
  if (!e) throw new HttpError(404, 'not_found');
  if (!['drafted', 'needs_human', 'error'].includes(e.status)) throw new HttpError(409, `status=${e.status} は却下できません`);
  e.status = 'rejected';
  saveEntry(e);
  return e;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 高スコアのリード/要人間対応をSlack・Discord・Make等のWebhookへ通知（任意） */
async function notifyIfNeeded(e: Entry) {
  const cfg = getConfig();
  const url = cfg.notifyWebhookUrl;
  if (!url || !isSafeWebhookUrl(url)) return;
  const isLead = (e.leadScore ?? 0) >= cfg.leadScoreThreshold && e.status !== 'skipped' && e.status !== 'error';
  if (!isLead && e.status !== 'needs_human') return;
  const label = e.status === 'needs_human' ? '🙋 要人間対応' : `🔥 見込み客 (スコア${e.leadScore})`;
  const summary = `${label} [${e.channel}/${e.kind}] ${e.senderName || e.senderId}\n> ${e.text.slice(0, 200)}${
    e.reply ? `\n返信案: ${e.reply.slice(0, 200)}` : ''
  }`;
  try {
    await httpJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Slack(text) / Discord(content) / Make・Zapier(その他のフィールド) 共用
        body: JSON.stringify({
          text: summary,
          content: summary,
          id: e.id,
          channel: e.channel,
          kind: e.kind,
          status: e.status,
          leadScore: e.leadScore,
          intent: e.intent,
          sender: { id: e.senderId, name: e.senderName, email: e.email },
          message: e.text,
          reply: e.reply,
          source: e.source,
        }),
      },
      5000
    );
  } catch (err) {
    console.warn('[notify] failed:', (err as Error).message);
  }
}
