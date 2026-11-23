import { getConfig, getKv, setKv } from './store.ts';
import { httpJson } from './util.ts';
import { getGoogleAccessToken } from './tokens.ts';
import { processInbound } from './pipeline.ts';
import { credentialStatus } from './channels.ts';

/**
 * YouTube にはコメントのWebhookがないため、定期的に新着コメントを取得して処理します。
 *
 * ・初回は「現在時刻」を基準点として保存するだけで、過去コメントには返信しません。
 * ・自分のチャンネルのコメント／すでに返信が付いているスレッドは対象外です。
 * ・クォータ目安: commentThreads.list=1ユニット, comments.insert=50ユニット（無料枠は1日10,000ユニット）
 *   → 自動返信は1日あたり約150〜200件が上限です。
 */

const KV_LAST = 'yt_last_published';

export async function pollYouTubeOnce(): Promise<{ checked: number; processed: number; baseline?: boolean }> {
  const cfg = getConfig();
  const channelId = cfg.youtube.channelId;
  if (!channelId) throw new Error('YouTubeチャンネルIDが未設定です');

  const token = await getGoogleAccessToken();
  const url =
    'https://www.googleapis.com/youtube/v3/commentThreads?' +
    new URLSearchParams({
      part: 'snippet',
      allThreadsRelatedToChannelId: channelId,
      order: 'time',
      maxResults: '50',
      textFormat: 'plainText',
    }).toString();
  const data = await httpJson(url, { headers: { Authorization: `Bearer ${token}` } });
  const items: any[] = data?.items || [];

  const last = getKv(KV_LAST);
  const newest = items.reduce((m, it) => Math.max(m, Date.parse(it?.snippet?.topLevelComment?.snippet?.publishedAt) || 0), 0);

  // 初回: 基準点だけ保存して終了（過去コメントへの一斉返信を防ぐ）
  if (!last) {
    setKv(KV_LAST, new Date(newest || Date.now()).toISOString());
    return { checked: items.length, processed: 0, baseline: true };
  }
  const since = Date.parse(last);

  // 古い順に処理
  const fresh = items
    .filter((it) => (Date.parse(it?.snippet?.topLevelComment?.snippet?.publishedAt) || 0) > since)
    .sort(
      (a, b) =>
        Date.parse(a.snippet.topLevelComment.snippet.publishedAt) - Date.parse(b.snippet.topLevelComment.snippet.publishedAt)
    );

  let processed = 0;
  for (const it of fresh) {
    const top = it.snippet.topLevelComment;
    const s = top.snippet;
    if (s.authorChannelId?.value === channelId) continue; // 自分のコメント
    if ((it.snippet.totalReplyCount || 0) > 0) continue; // すでに返信あり
    const text = s.textOriginal || s.textDisplay;
    if (!text) continue;
    await processInbound({
      channel: 'youtube',
      kind: 'comment',
      eventId: 'yt_' + top.id,
      senderId: s.authorChannelId?.value || s.authorDisplayName || 'unknown',
      senderName: s.authorDisplayName,
      text,
      ref: { parentId: top.id, videoId: s.videoId || '' },
      source: { type: 'poll', page: s.videoId ? `https://www.youtube.com/watch?v=${s.videoId}` : undefined },
    });
    processed++;
  }

  if (newest) setKv(KV_LAST, new Date(Math.max(newest, since)).toISOString());
  return { checked: items.length, processed };
}

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick() {
  const cfg = getConfig();
  const next = Math.max(2, cfg.youtube.pollMinutes) * 60_000;
  try {
    if (!running && cfg.masterEnabled && cfg.channels.youtube.mode !== 'off' && credentialStatus().youtube.configured) {
      running = true;
      const r = await pollYouTubeOnce();
      if (r.processed || r.baseline) console.log('[youtube] poll', r);
    }
  } catch (err) {
    console.warn('[youtube] poll failed:', (err as Error).message);
  } finally {
    running = false;
    timer = setTimeout(tick, next);
    timer.unref?.();
  }
}

export function startYouTubePoller() {
  if (timer) return;
  timer = setTimeout(tick, 15_000);
  timer.unref?.();
}
