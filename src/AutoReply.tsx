import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Globe,
  Inbox,
  KeyRound,
  Power,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { TOKEN_KEY } from './apiClient.ts';

// ---------------------------------------------------------------------------
// 型・定数
// ---------------------------------------------------------------------------

type Mode = 'off' | 'draft' | 'auto';
// X(旧Twitter)は有料APIプランが前提のため、現在は対象外
type ChannelId = 'instagram' | 'facebook' | 'youtube' | 'line' | 'web';

interface Props {
  persona: { name: string; role: string; tone: string; relationToBoss: string; visualStyle: string };
  bossProfile: Record<string, string>;
}

const CHANNELS: { id: ChannelId; label: string; icon: string; desc: string; hook?: 'meta' | 'line' }[] = [
  { id: 'instagram', label: 'Instagram', icon: '📸', desc: '投稿へのコメント／DMに自動返信', hook: 'meta' },
  { id: 'facebook', label: 'Facebook', icon: '👍', desc: 'ページのコメント／Messengerに自動返信', hook: 'meta' },
  { id: 'youtube', label: 'YouTube', icon: '▶️', desc: '動画コメントを定期取得して返信（Webhookなし）' },
  { id: 'line', label: 'LINE公式アカウント', icon: '💬', desc: 'トークに自動返信', hook: 'line' },
  { id: 'web', label: 'LP / HP', icon: '🌐', desc: 'チャットウィジェット／問い合わせフォームに自動返信' },
];

const MODE_LABEL: Record<Mode, string> = { off: 'オフ', draft: '下書き（承認制）', auto: '全自動' };

const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  drafted: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  needs_human: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  skipped: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
  rejected: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};
const STATUS_LABEL: Record<string, string> = {
  sent: '送信済み',
  drafted: '承認待ち',
  needs_human: '要人間対応',
  error: 'エラー',
  skipped: 'スキップ',
  rejected: '却下',
};


async function api(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e: any = new Error(data.message || data.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// ---------------------------------------------------------------------------
// 小物コンポーネント
// ---------------------------------------------------------------------------

function CopyBox({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div className="flex items-stretch gap-2">
        <pre className="flex-1 min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 border border-slate-800 p-2 text-[11px] text-slate-300">
          {value}
        </pre>
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
          className="shrink-0 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
          title="コピー"
        >
          {done ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function Card({ title, icon, children, right }: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          {icon}
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

const inputCls =
  'w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60';

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export default function AutoReply({ persona, bossProfile }: Props) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [tokenInput, setTokenInput] = useState('');
  const [server, setServer] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [originsText, setOriginsText] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [inbox, setInbox] = useState<any[]>([]);
  const [inboxFilter, setInboxFilter] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});

  const [testChannel, setTestChannel] = useState<ChannelId>('instagram');
  const [testKind, setTestKind] = useState<'dm' | 'comment'>('dm');
  const [testMsg, setTestMsg] = useState('うちの会社もAI導入したいんですが、何から始めればいいですか？');
  const [testOut, setTestOut] = useState<any>(null);

  const notify = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 2500);
  };

  const draftReady = useRef(false);

  const applyState = useCallback((s: any, force = false) => {
    setServer(s);
    // 編集中の内容は、明示的な保存/再読込(force)以外では上書きしない
    if (force || !draftReady.current) {
      draftReady.current = true;
      setDraft(JSON.parse(JSON.stringify(s.config)));
      setOriginsText((s.config.web.allowedOrigins || []).join('\n'));
      setKeywordsText((s.config.handoffKeywords || []).join(', '));
      setDirty(false);
    }
  }, []);

  const load = useCallback(
    async (force = false) => {
      try {
        const s = await api('/api/admin/state', token);
        applyState(s, force);
        setNeedsAuth(false);
        setError('');
      } catch (e: any) {
        if (e.status === 401 || e.status === 503) setNeedsAuth(true);
        setError(e.message);
      }
    },
    [token, applyState]
  );

  const loadInbox = useCallback(async () => {
    try {
      const d = await api(`/api/admin/inbox?limit=50${inboxFilter ? `&status=${inboxFilter}` : ''}`, token);
      setInbox(d.entries || []);
    } catch {
      /* 認証エラーは load() 側で表示 */
    }
  }, [token, inboxFilter]);

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (needsAuth) return;
    loadInbox();
    const t = setInterval(() => {
      loadInbox();
      load(false);
    }, 15000);
    return () => clearInterval(t);
  }, [loadInbox, load, needsAuth]);

  // ---- 保存系 ----

  const put = async (body: any, label: string) => {
    setBusy(label);
    try {
      const s = await api('/api/admin/config', token, { method: 'PUT', body: JSON.stringify(body) });
      applyState(s, true);
      notify('保存しました');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const saveSettings = () =>
    put(
      {
        channels: draft.channels,
        youtube: draft.youtube,
        web: {
          allowedOrigins: originsText.split('\n').map((s) => s.trim()).filter(Boolean),
          holdingMessage: draft.web.holdingMessage,
        },
        limits: draft.limits,
        disclosure: draft.disclosure,
        handoffKeywords: keywordsText.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean),
        notifyWebhookUrl: draft.notifyWebhookUrl,
        leadScoreThreshold: draft.leadScoreThreshold,
      },
      'save'
    );

  const toggleMaster = async () => {
    const next = !server.config.masterEnabled;
    if (next && !window.confirm('自動返信を有効にします。「全自動」にしたチャンネルでは、届いたメッセージにAIが自動で返信します。よろしいですか？')) return;
    await put({ masterEnabled: next }, 'master');
  };

  const personaPayload = useMemo(
    () => ({
      persona: {
        name: persona.name,
        role: persona.role,
        tone: persona.tone,
        relationToBoss: persona.relationToBoss,
        visualStyle: persona.visualStyle,
      },
      bossProfile,
    }),
    [persona, bossProfile]
  );

  const synced = useMemo(() => {
    if (!server?.config?.persona || !server?.config?.bossProfile) return false;
    const a = server.config.persona;
    const b = server.config.bossProfile;
    return (
      Object.keys(personaPayload.persona).every((k) => (a[k] ?? '') === (personaPayload.persona as any)[k]) &&
      Object.keys(personaPayload.bossProfile).every((k) => (b[k] ?? '') === (personaPayload.bossProfile as any)[k])
    );
  }, [server, personaPayload]);

  const setCh = (id: ChannelId, patch: any) => {
    setDraft((d: any) => ({ ...d, channels: { ...d.channels, [id]: { ...d.channels[id], ...patch } } }));
    setDirty(true);
  };
  const setField = (path: [string, string], value: any) => {
    setDraft((d: any) => ({ ...d, [path[0]]: { ...d[path[0]], [path[1]]: value } }));
    setDirty(true);
  };

  // ---- 受信ログ操作 ----

  const approve = async (e: any) => {
    setBusy('a' + e.id);
    try {
      await api(`/api/admin/inbox/${e.id}/approve`, token, { method: 'POST', body: JSON.stringify({ reply: edits[e.id] ?? e.reply ?? '' }) });
      notify('送信しました');
      await loadInbox();
      await load(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };
  const reject = async (e: any) => {
    try {
      await api(`/api/admin/inbox/${e.id}/reject`, token, { method: 'POST', body: '{}' });
      await loadInbox();
      await load(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setTestOut(null);
    try {
      const d = await api('/api/admin/test-reply', token, {
        method: 'POST',
        body: JSON.stringify({ channel: testChannel, kind: testChannel === 'web' ? 'web' : testKind, message: testMsg }),
      });
      setTestOut(d.result);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const pollYoutube = async () => {
    setBusy('yt');
    try {
      const d = await api('/api/admin/youtube/poll', token, { method: 'POST', body: '{}' });
      notify(d.result.baseline ? '基準点を保存しました（以降の新着コメントに返信します）' : `確認: ${d.result.checked}件 / 処理: ${d.result.processed}件`);
      await loadInbox();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const rotate = async (which: 'api' | 'site') => {
    if (!window.confirm(which === 'api' ? 'APIキーを再発行します。既存の連携は新しいキーに更新が必要です。' : 'サイトキーを再発行します。LP/HPの埋め込みコードを更新する必要があります。')) return;
    try {
      const s = await api('/api/admin/keys/rotate', token, { method: 'POST', body: JSON.stringify({ which }) });
      applyState(s, false);
      notify('再発行しました');
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ---- 認証ゲート ----

  if (needsAuth) {
    return (
      <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-amber-400" />
          管理トークンが必要です
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          自動返信の設定は、サーバーの環境変数 <code className="text-amber-300">ADMIN_TOKEN</code> に設定した値で保護されています。
          開発中（localhost）で ADMIN_TOKEN 未設定の場合は不要です。
        </p>
        <input type="password" className={inputCls} placeholder="ADMIN_TOKEN" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <button
          onClick={() => {
            sessionStorage.setItem(TOKEN_KEY, tokenInput);
            setToken(tokenInput);
          }}
          className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2 text-sm"
        >
          開く
        </button>
      </div>
    );
  }

  if (!server || !draft) {
    return <div className="text-sm text-slate-400 p-6">読み込み中…</div>;
  }

  const cfg = server.config;
  const cred = server.credentials;
  const urls = server.urls;
  const master = cfg.masterEnabled;
  const activeCount = (Object.values(cfg.channels) as any[]).filter((c) => c.mode !== 'off').length;

  const widgetSnippet = `<script src="${urls.widgetScript}" data-site-key="${cfg.web.siteKey}" async></script>`;
  const formSnippet = `fetch("${urls.webInbound}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    siteKey: "${cfg.web.siteKey}",
    sessionId: crypto.randomUUID().replace(/-/g, ""),
    type: "form",
    name: "山田太郎",
    email: "taro@example.com",
    message: "お問い合わせ内容",
    page: location.href
  })
}).then(r => r.json()).then(d => console.log(d.reply));`;
  const curlSnippet = `curl -X POST ${urls.api} \\
  -H "Authorization: Bearer ${showKey ? server.apiKey : 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"lp","message":"導入について相談したい","sender":{"id":"user-1","name":"山田","email":"taro@example.com"}}'`;

  return (
    <div className="space-y-6">
      {/* ステータスバー */}
      <div
        className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
          master ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex items-center gap-3">
          <Power className={`w-6 h-6 ${master ? 'text-emerald-400' : 'text-slate-500'}`} />
          <div>
            <div className="text-sm font-bold text-white">{master ? '自動返信：稼働中' : '自動返信：停止中'}</div>
            <div className="text-xs text-slate-400">
              {master ? `${activeCount}チャンネルが有効 ／ 承認待ち ${server.stats.pending}件 ／ 直近7日のリード ${server.stats.leads}件` : '全体スイッチをONにするまで、どのチャンネルにも返信しません'}
            </div>
          </div>
        </div>
        <button
          onClick={toggleMaster}
          disabled={busy === 'master'}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${master ? 'bg-rose-500/90 hover:bg-rose-500 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-950'}`}
        >
          {master ? '緊急停止する' : '自動返信を開始する'}
        </button>
      </div>

      {(error || flash) && (
        <div className={`rounded-xl border px-4 py-2 text-xs flex items-center gap-2 ${error ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'}`}>
          {error ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          {error || flash}
        </div>
      )}

      {!cred.gemini.configured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          GEMINI_API_KEY が未設定のため、返信を生成できません（自動送信もされません）。
        </div>
      )}

      {/* ペルソナ同期 */}
      <Card title="AIキャラ＆ボス設定の反映" icon={<Bot className="w-5 h-5 text-amber-400" />}>
        <p className="text-xs text-slate-400 leading-relaxed">
          自動返信はブラウザを閉じていてもサーバー上で動くため、「AIキャラ＆ボス設定」タブの内容をサーバーに反映しておく必要があります。設定を変えたら再度反映してください。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-xs px-2.5 py-1 rounded-full border ${synced ? STATUS_STYLE.sent : STATUS_STYLE.drafted}`}>
            {synced ? `反映済み：${persona.name}` : cfg.persona ? '未反映の変更があります（サーバーは古い設定で動作中）' : '未反映（自動返信は動作しません）'}
          </span>
          <button
            onClick={() => put(personaPayload, 'persona')}
            disabled={busy === 'persona' || synced}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40"
          >
            現在の設定をサーバーに反映
          </button>
        </div>
      </Card>

      {/* チャンネル */}
      <Card
        title="チャンネル別の自動返信"
        icon={<Send className="w-5 h-5 text-amber-400" />}
        right={
          <button
            onClick={saveSettings}
            disabled={!dirty || busy === 'save'}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40"
          >
            {dirty ? '設定を保存' : '保存済み'}
          </button>
        }
      >
        <p className="text-xs text-slate-400 leading-relaxed">
          <strong className="text-slate-200">下書き（承認制）</strong>は、AIが返信案を作るだけで、下の受信ログで承認するまで送信しません。最初は下書きで品質を確認してから「全自動」へ切り替えるのがおすすめです。
        </p>

        <div className="space-y-3">
          {CHANNELS.map((ch) => {
            const c = draft.channels[ch.id];
            const st = cred[ch.id];
            return (
              <div key={ch.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="text-xl w-8 text-center">{ch.icon}</div>
                    <div>
                      <div className="text-sm font-semibold text-white">{ch.label}</div>
                      <div className="text-xs text-slate-400">{ch.desc}</div>
                      <div className="mt-1">
                        {st.configured ? (
                          <span className="text-[11px] text-emerald-300">● 接続情報OK</span>
                        ) : (
                          <span className="text-[11px] text-amber-300">● 未設定: {st.missing.join(' / ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg overflow-hidden border border-slate-700">
                    {(['off', 'draft', 'auto'] as Mode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setCh(ch.id, { mode: m })}
                        className={`px-3 py-1.5 text-xs font-medium ${
                          c.mode === m ? (m === 'auto' ? 'bg-emerald-500 text-slate-950' : m === 'draft' ? 'bg-amber-500 text-slate-950' : 'bg-slate-600 text-white') : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>

                {c.mode !== 'off' && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-400">このチャンネル専用の誘導文（空ならボス設定の「誘導アクション」を使用）</label>
                      <input
                        className={inputCls + ' mt-1'}
                        value={c.ctaOverride}
                        maxLength={300}
                        placeholder={ch.id === 'youtube' ? '例: 概要欄の公式LINEから「壁打ち」と送ってください' : '例: プロフィールのリンクから無料相談へ'}
                        onChange={(e) => setCh(ch.id, { ctaOverride: e.target.value })}
                      />
                    </div>
                    {ch.hook && <CopyBox label={`Webhook URL（${ch.hook === 'meta' ? 'Meta for Developers' : 'LINE Developers'} に登録）`} value={urls[ch.hook]} />}
                    {ch.id === 'youtube' && (
                      <div className="grid sm:grid-cols-3 gap-3 items-end">
                        <div className="sm:col-span-2">
                          <label className="text-[11px] font-semibold text-slate-400">YouTubeチャンネルID（UCから始まる）</label>
                          <input className={inputCls + ' mt-1'} value={draft.youtube.channelId} placeholder="UCxxxxxxxxxxxxxxxxxxxxxx" onChange={(e) => setField(['youtube', 'channelId'], e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-slate-400">確認間隔（分）</label>
                          <input type="number" min={2} max={60} className={inputCls + ' mt-1'} value={draft.youtube.pollMinutes} onChange={(e) => setField(['youtube', 'pollMinutes'], Number(e.target.value))} />
                        </div>
                        <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                          <button onClick={pollYoutube} disabled={busy === 'yt' || dirty} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 flex items-center gap-1.5">
                            <RefreshCw className="w-3.5 h-3.5" />
                            今すぐ新着コメントを確認
                          </button>
                          <span className="text-[11px] text-slate-500">初回は現時点を基準にするだけで、過去コメントには返信しません。返信1件で約50クォータを消費します（無料枠は1日10,000）。</span>
                        </div>
                      </div>
                    )}
                    {ch.id === 'web' && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-[11px] font-semibold text-slate-400">許可するサイトのURL（1行に1つ。例: https://lp.example.com）</label>
                          <textarea
                            rows={3}
                            className={inputCls + ' mt-1 font-mono text-xs'}
                            value={originsText}
                            placeholder={'https://lp.example.com\nhttps://www.example.com'}
                            onChange={(e) => {
                              setOriginsText(e.target.value);
                              setDirty(true);
                            }}
                          />
                          <p className="text-[11px] text-slate-500 mt-1">未設定の間は、すべてのリクエストを拒否します（他サイトからの不正利用防止）。</p>
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-slate-400">下書き/要人間対応のときに訪問者へ表示するメッセージ</label>
                          <input className={inputCls + ' mt-1'} value={draft.web.holdingMessage} onChange={(e) => setField(['web', 'holdingMessage'], e.target.value)} />
                        </div>
                        <CopyBox label="① チャットウィジェット：LP/HPの </body> 直前に貼り付け" value={widgetSnippet} />
                        <p className="text-[11px] text-slate-500">オプション: data-title / data-greeting / data-color="#RRGGBB" / data-position="left"</p>
                        <CopyBox label="② 自作の問い合わせフォームから呼ぶ場合（メールで返信するには RESEND_API_KEY と MAIL_FROM が必要）" value={formSnippet} />
                        <button onClick={() => rotate('site')} className="text-[11px] text-slate-400 hover:text-white underline">
                          サイトキーを再発行
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 安全設定 */}
      <Card title="安全設定" icon={<ShieldCheck className="w-5 h-5 text-amber-400" />}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-400">同じ相手への返信上限（回/時間）</label>
            <input type="number" min={1} max={100} className={inputCls + ' mt-1'} value={draft.limits.perSenderPerHour} onChange={(e) => setField(['limits', 'perSenderPerHour'], Number(e.target.value))} />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-400">全体の返信上限（回/時間）</label>
            <input type="number" min={1} max={2000} className={inputCls + ' mt-1'} value={draft.limits.globalPerHour} onChange={(e) => setField(['limits', 'globalPerHour'], Number(e.target.value))} />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-400">人間が対応するキーワード（カンマ区切り。含まれる場合はAIで返信せず「要人間対応」にします）</label>
          <textarea
            rows={2}
            className={inputCls + ' mt-1'}
            value={keywordsText}
            onChange={(e) => {
              setKeywordsText(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={draft.disclosure.enabled}
                onChange={(e) => setField(['disclosure', 'enabled'], e.target.checked)}
              />
              AIによる自動返信であることを明記する（コメント返信と初回DMに付与）
            </label>
            <input className={inputCls + ' mt-2'} value={draft.disclosure.text} maxLength={100} onChange={(e) => setField(['disclosure', 'text'], e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-400">リード通知のスコア閾値（0〜100）</label>
            <input type="number" min={0} max={100} className={inputCls + ' mt-1'} value={draft.leadScoreThreshold} onChange={(e) => { setDraft({ ...draft, leadScoreThreshold: Number(e.target.value) }); setDirty(true); }} />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-400">通知先Webhook URL（Slack / Discord / Make / Zapier。https のみ。見込み客・要人間対応が来たときに通知）</label>
          <input
            className={inputCls + ' mt-1'}
            value={draft.notifyWebhookUrl}
            placeholder="https://hooks.slack.com/services/…"
            onChange={(e) => { setDraft({ ...draft, notifyWebhookUrl: e.target.value }); setDirty(true); }}
          />
        </div>
        <p className="text-[11px] text-slate-500">
          APIの認証情報（各SNSのトークンなど）は画面ではなく、サーバーの環境変数で設定します。{!server.adminProtected && <span className="text-amber-300"> ※ ADMIN_TOKEN が未設定です。公開環境では必ず設定してください。</span>}
        </p>
      </Card>

      {/* API */}
      <Card title="API連携（Make / Zapier / n8n / 自社システム）" icon={<Globe className="w-5 h-5 text-amber-400" />}>
        <p className="text-xs text-slate-400 leading-relaxed">
          任意のサービスから<code className="text-amber-300"> POST {urls.api} </code>を呼ぶと、AIが返信文を生成して返します（配信は呼び出し側で実施）。
          channel は instagram / facebook / youtube / line / web（lp・hp・form も可）。同じ <code className="text-amber-300">eventId</code> を渡すと重複を防げます。
        </p>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-400">APIキー</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-300">
              {showKey ? server.apiKey : '•'.repeat(24)}
            </code>
            <button onClick={() => setShowKey(!showKey)} className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">
              {showKey ? '隠す' : '表示'}
            </button>
            <button onClick={() => navigator.clipboard.writeText(server.apiKey)} className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="コピー">
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={() => rotate('api')} className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">
              再発行
            </button>
          </div>
        </div>
        <CopyBox label="リクエスト例" value={curlSnippet} />
      </Card>

      {/* プレビュー */}
      <Card title="返信プレビュー（送信されません）" icon={<Bot className="w-5 h-5 text-amber-400" />}>
        <div className="grid sm:grid-cols-4 gap-3">
          <select className={inputCls} value={testChannel} onChange={(e) => setTestChannel(e.target.value as ChannelId)}>
            {CHANNELS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <select className={inputCls} value={testKind} disabled={testChannel === 'web'} onChange={(e) => setTestKind(e.target.value as 'dm' | 'comment')}>
            <option value="dm">DM</option>
            <option value="comment">公開コメント</option>
          </select>
          <button onClick={runTest} disabled={busy === 'test' || !synced} className="sm:col-span-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold py-2 disabled:opacity-40">
            {busy === 'test' ? '生成中…' : synced ? '返信案を生成' : '先に設定をサーバーへ反映してください'}
          </button>
        </div>
        <textarea rows={2} className={inputCls} value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
        {testOut && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">意図: {testOut.intent}</span>
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">リードスコア: {testOut.leadScore}</span>
              {testOut.needsHuman && <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300">要人間対応</span>}
              {!testOut.shouldReply && <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">返信しない判定</span>}
            </div>
            <p className="text-sm text-slate-200 whitespace-pre-wrap">{testOut.reply || '（返信なし）'}</p>
          </div>
        )}
      </Card>

      {/* 受信ログ */}
      <Card
        title="受信ログ・承認キュー"
        icon={<Inbox className="w-5 h-5 text-amber-400" />}
        right={
          <div className="flex items-center gap-2">
            <select className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-300" value={inboxFilter} onChange={(e) => setInboxFilter(e.target.value)}>
              <option value="">すべて</option>
              <option value="drafted">承認待ち</option>
              <option value="needs_human">要人間対応</option>
              <option value="sent">送信済み</option>
              <option value="error">エラー</option>
              <option value="skipped">スキップ</option>
            </select>
            <button onClick={loadInbox} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="更新">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        }
      >
        {inbox.length === 0 && <p className="text-xs text-slate-500">まだ受信がありません。</p>}
        <div className="space-y-3">
          {inbox.map((e) => {
            const actionable = ['drafted', 'needs_human', 'error'].includes(e.status);
            const ch = CHANNELS.find((c) => c.id === e.channel);
            return (
              <div key={e.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`px-2 py-0.5 rounded-full border ${STATUS_STYLE[e.status] || ''}`}>{STATUS_LABEL[e.status] || e.status}</span>
                  <span className="text-slate-300">{ch?.icon} {ch?.label}・{e.kind === 'comment' ? 'コメント' : 'DM/チャット'}</span>
                  <span className="text-slate-500">{e.senderName || e.senderId}</span>
                  <span className="text-slate-600">{new Date(e.createdAt).toLocaleString('ja-JP')}</span>
                  {typeof e.leadScore === 'number' && e.leadScore > 0 && <span className="text-amber-300">スコア {e.leadScore}</span>}
                </div>
                <p className="text-sm text-slate-300 whitespace-pre-wrap">💬 {e.text}</p>
                {actionable ? (
                  <>
                    <textarea
                      rows={3}
                      className={inputCls}
                      placeholder={e.reply ? '' : '返信を入力して送信できます'}
                      value={edits[e.id] ?? e.reply ?? ''}
                      onChange={(ev) => setEdits({ ...edits, [e.id]: ev.target.value })}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => approve(e)} disabled={busy === 'a' + e.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-40">
                        この内容で送信
                      </button>
                      <button onClick={() => reject(e)} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300">
                        送信しない
                      </button>
                    </div>
                  </>
                ) : (
                  e.reply && <p className="text-sm text-amber-100/90 whitespace-pre-wrap">🤖 {e.reply}</p>
                )}
                {e.note && <p className="text-[11px] text-slate-500">{e.note}</p>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
