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
import { BOSS_FIELD_LABEL, sampleFields } from './sample.ts';

// ---------------------------------------------------------------------------
// 型・定数
// ---------------------------------------------------------------------------

type Mode = 'off' | 'draft' | 'auto';
// X(旧Twitter)は有料APIプランが前提のため、現在は対象外
type ChannelId = 'instagram' | 'facebook' | 'youtube' | 'line' | 'web';

interface Props {
  persona: { name: string; role: string; tone: string; relationToBoss: string; visualStyle: string };
  bossProfile: Record<string, string>;
  /** サーバーに反映済みの設定を、画面（ブラウザ）側に読み込む */
  onLoadFromServer?: (bossProfile: Record<string, string>, persona: Record<string, string>) => void;
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

export default function AutoReply({ persona, bossProfile, onLoadFromServer }: Props) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [tokenInput, setTokenInput] = useState('');
  const [server, setServer] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [originsText, setOriginsText] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [lineIdsText, setLineIdsText] = useState('');
  const [notifyTest, setNotifyTest] = useState<Record<string, { ok: boolean; message: string }> | null>(null);
  /** 通知先登録コード（自分のLINEから送ってもらう） */
  const [regCode, setRegCode] = useState<{ code: string; message: string; expiresAt: string } | null>(null);
  /** LINE Webhook 自動設定の結果 */
  const [lineSetup, setLineSetup] = useState<{ ok: boolean; active: boolean | null; message: string; endpoint: string } | null>(null);
  /** クリップボードにコピーできなかったときに表示する GAS コード */
  const [gasCodeText, setGasCodeText] = useState('');
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
      setLineIdsText((s.config.lineNotify?.userIds || []).join('\n'));
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
        lineNotify: {
          enabled: !!draft.lineNotify?.enabled,
          userIds: lineIdsText.split(/[\s,、]+/).map((s) => s.trim()).filter(Boolean),
          monthlyCap: draft.lineNotify?.monthlyCap,
        },
        sheetWebhookUrl: draft.sheetWebhookUrl,
        leadScoreThreshold: draft.leadScoreThreshold,
      },
      'save'
    );

  /** 通知先登録コードを発行する（自分のLINEから送ると、自動で通知先に追加される） */
  const issueRegCode = async () => {
    setBusy('reg');
    try {
      const d = await api('/api/admin/line/register-code', token, { method: 'POST', body: '{}' });
      setRegCode({ code: d.code, message: d.message, expiresAt: d.expiresAt });
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  // コード発行中は3秒ごとにサーバーを確認し、登録されたら画面に反映する
  useEffect(() => {
    if (!regCode) return;
    const known = new Set(lineIdsText.split(/[\s,、]+/).filter(Boolean));
    const t = setInterval(async () => {
      if (Date.parse(regCode.expiresAt) < Date.now()) {
        setRegCode(null);
        setError('登録コードの有効期限が切れました。もう一度「コードを発行」を押してください。');
        return;
      }
      try {
        const s = await api('/api/admin/state', token);
        const ids: string[] = s.config.lineNotify?.userIds || [];
        if (ids.some((id) => !known.has(id))) {
          const merged = [...new Set([...known, ...ids])];
          setServer(s);
          setLineIdsText(merged.join('\n'));
          setDraft((d: any) => ({ ...d, lineNotify: { ...(d.lineNotify || {}), enabled: true, userIds: merged } }));
          setRegCode(null);
          notify('✅ あなたのLINEを通知先に登録しました');
        }
      } catch {
        /* 次の確認で再試行 */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [regCode, token, lineIdsText]);

  /** LINE に Webhook URL を自動登録し、疎通テストする */
  const autoSetupLine = async () => {
    setBusy('lineSetup');
    setLineSetup(null);
    try {
      const d = await api('/api/admin/line/setup-webhook', token, { method: 'POST', body: '{}' });
      setLineSetup(d.result);
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  /** 合言葉入りの GAS コードをクリップボードにコピーする */
  const copyGasCode = async () => {
    setBusy('gas');
    try {
      const res = await fetch('/api/admin/gas-code', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`GASコードを取得できませんでした（HTTP ${res.status}）`);
      const text = await res.text();
      try {
        await navigator.clipboard.writeText(text);
        setGasCodeText('');
        notify('GASコードをコピーしました。Apps Script に貼り付けてください');
      } catch {
        setGasCodeText(text); // コピーできない環境では、画面に表示して手動でコピーしてもらう
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  /** 保存済みの LINE通知 / 記録用Webhook にテスト送信する */
  const testNotify = async () => {
    setBusy('notify');
    setNotifyTest(null);
    try {
      const d = await api('/api/admin/test-notify', token, { method: 'POST', body: '{}' });
      setNotifyTest(d.result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const toggleMaster = async () => {
    const next = !server.config.masterEnabled;
    if (next && sampleFields(server.config.bossProfile).length) {
      if (!window.confirm('⚠️ サーバーのボス情報に、サンプル（【例】・〇〇）が残っています。このままだとAIがサンプルの内容を話してしまいます。それでも開始しますか？')) return;
    }
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
            const t = tokenInput.trim(); // コピー時に紛れ込む前後の空白・改行を除く
            sessionStorage.setItem(TOKEN_KEY, t);
            setToken(t);
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

      {server.usage && (
        <div className="grid sm:grid-cols-2 gap-3">
          {([
            ['今日のAI返信', server.usage.aiToday, server.usage.aiCap, '件'],
            ['今月の自分へのLINE通知', server.usage.lineNotifyMonth, server.usage.lineNotifyCap, '通'],
          ] as [string, number, number, string][]).map(([label, used, cap, unit]) => {
            const full = cap > 0 && used >= cap;
            const near = cap > 0 && !full && used >= cap * 0.8;
            return (
              <div
                key={label}
                className={`rounded-xl border px-4 py-2 text-xs flex items-center justify-between ${
                  full ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : near ? 'bg-amber-500/10 border-amber-500/30 text-amber-200' : 'bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                <span>{label}</span>
                <span className="font-semibold">
                  {used} / {cap > 0 ? `${cap}${unit}` : '無制限'}
                  {full ? '（上限に達しています）' : near ? '（まもなく上限）' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

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
            onClick={() => {
              const left = sampleFields(bossProfile);
              if (left.length && !window.confirm(`ボス情報の「${left.map((k) => BOSS_FIELD_LABEL[k]).join('」「')}」がサンプルのままです。このまま反映しますか？`)) return;
              put(personaPayload, 'persona');
            }}
            disabled={busy === 'persona' || synced}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40"
          >
            現在の設定をサーバーに反映
          </button>
        </div>
        {/* 公開版を別のブラウザで開いたとき：サーバーの設定を読み込める */}
        {!synced && cfg.persona && cfg.bossProfile && sampleFields(bossProfile).length > 0 && sampleFields(cfg.bossProfile).length === 0 && onLoadFromServer && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
            <span className="text-[11px] text-emerald-200">サーバーには「{cfg.persona.name}」の設定が保存されています。</span>
            <button
              onClick={() => onLoadFromServer(cfg.bossProfile, cfg.persona)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950"
            >
              この画面に読み込む
            </button>
          </div>
        )}
        {sampleFields(bossProfile).length > 0 && (
          <p className="text-[11px] text-amber-300">
            ⚠️ ボス情報の「{sampleFields(bossProfile).map((k) => BOSS_FIELD_LABEL[k]).join('」「')}」がサンプル（【例】・〇〇）のままです。「AIキャラ＆ボス設定」タブで、あなたの本当の情報に書き換えてください。
          </p>
        )}
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

                {ch.id === 'line' && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={autoSetupLine}
                        disabled={busy === 'lineSetup' || !cred.line?.configured}
                        className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 flex items-center gap-1.5"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${busy === 'lineSetup' ? 'animate-spin' : ''}`} />
                        LINEにWebhookを自動設定（登録＋接続テスト）
                      </button>
                      <span className="text-[11px] text-slate-500">公開後（https）に使えます。npm run deploy でも自動で実行されます。</span>
                    </div>
                    {lineSetup && (
                      <p className={`text-[11px] ${lineSetup.ok && lineSetup.active !== false ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {lineSetup.ok && lineSetup.active !== false ? '✅' : '⚠️'} {lineSetup.message}
                      </p>
                    )}
                  </div>
                )}
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
          <div>
            <label className="text-[11px] font-semibold text-slate-400">1日のAI返信の上限（件。0＝無制限）</label>
            <input type="number" min={0} max={100000} className={inputCls + ' mt-1'} value={draft.limits.aiPerDay ?? 30} onChange={(e) => setField(['limits', 'aiPerDay'], Number(e.target.value))} />
            <p className="text-[11px] text-slate-500 mt-1">超えたらAIは返信せず「要人間対応」になり、その日1回だけLINEで通知します（日本時間0時にリセット）。Geminiの利用料の暴走を防ぎます。</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-400">自分へのLINE通知の月間上限（通。0＝無制限）</label>
            <input type="number" min={0} max={1000000} className={inputCls + ' mt-1'} value={draft.lineNotify?.monthlyCap ?? 100} onChange={(e) => setField(['lineNotify', 'monthlyCap'], Number(e.target.value))} />
            <p className="text-[11px] text-slate-500 mt-1">LINE公式アカウントの無料プランは月200通までです（通知・下書き承認後の送信が数えられます）。上限に達すると、その月の通知は止まります。</p>
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
        {/* LINE通知（運営者自身のLINEへ） */}
        <div className="rounded-xl border border-slate-800 p-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={!!draft.lineNotify?.enabled}
              onChange={(e) => setField(['lineNotify', 'enabled'], e.target.checked)}
            />
            見込み客・要人間対応が来たら、自分のLINEに通知する
          </label>
          <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-200">かんたん登録：自分のLINEからコードを送るだけ</div>
            {!regCode ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={issueRegCode}
                  disabled={busy === 'reg' || !cred.line?.configured}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40"
                >
                  登録コードを発行
                </button>
                <span className="text-[11px] text-slate-500">
                  {cred.line?.configured ? '公開後、LINEのWebhook設定が済んでから使えます。' : 'LINEのキー設定（npm run setup）が先に必要です。'}
                </span>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-300">あなたのLINEで、この公式アカウントに次のメッセージを送ってください（10分以内）。</p>
                <CopyBox label="送るメッセージ" value={regCode.message} />
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 登録を待っています…（届くと自動でこの画面に反映されます）
                </p>
              </div>
            )}
          </div>
          <label className="text-[11px] font-semibold text-slate-400 block">
            通知先のLINEユーザーID（自動で入ります。手で入れる場合は「U」から始まる33文字を1行に1つ・最大5件）
          </label>
          <textarea
            rows={2}
            className={inputCls + ' font-mono text-xs'}
            value={lineIdsText}
            placeholder="U0123456789abcdef0123456789abcdef"
            onChange={(e) => {
              setLineIdsText(e.target.value);
              setDirty(true);
            }}
          />
          <p className="text-[11px] text-slate-500">
            通知を受け取るには、その LINE アカウントでこの公式アカウントを友だち追加しておく必要があります。通知は公式アカウントの月間メッセージ通数にカウントされます。
          </p>
        </div>

        {/* 記録用Webhook（GAS → スプレッドシート） */}
        <div className="rounded-xl border border-slate-800 p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-200">スプレッドシートに全件記録（Google Apps Script）</div>
          <ol className="text-[11px] text-slate-400 list-decimal list-inside space-y-0.5">
            <li>下のボタンでコードをコピー（合言葉は入力済み）</li>
            <li>スプレッドシート →「拡張機能」→「Apps Script」に貼り付けて保存</li>
            <li>「デプロイ」→「新しいデプロイ」→ ウェブアプリ（実行：自分／アクセス：全員）</li>
            <li>表示されたURL（…/exec）を下に貼って「設定を保存」</li>
          </ol>
          <button
            onClick={copyGasCode}
            disabled={busy === 'gas'}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            GASコードをコピー
          </button>
          {gasCodeText && (
            <div className="space-y-1">
              <p className="text-[11px] text-amber-300">自動コピーできませんでした。下の枠をクリックして全選択（Ctrl/⌘ + A）→ コピーしてください。</p>
              <textarea readOnly rows={6} className={inputCls + ' font-mono text-[11px]'} value={gasCodeText} onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
          <label className="text-[11px] font-semibold text-slate-400 block">記録用Webhook URL（GAS のウェブアプリURL。合言葉はアプリが自動で付けます）</label>
          <input
            className={inputCls + ' font-mono text-xs'}
            value={draft.sheetWebhookUrl || ''}
            placeholder="https://script.google.com/macros/s/…/exec"
            onChange={(e) => { setDraft({ ...draft, sheetWebhookUrl: e.target.value }); setDirty(true); }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={testNotify}
            disabled={busy === 'notify' || dirty}
            className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            LINE通知・スプレッドシートにテスト送信
          </button>
          {dirty && <span className="text-[11px] text-amber-300">先に設定を保存してください</span>}
        </div>
        {notifyTest && (
          <ul className="text-[11px] space-y-1">
            {Object.entries(notifyTest).map(([k, v]) => (
              <li key={k} className={v.ok ? 'text-emerald-300' : 'text-rose-300'}>
                {v.ok ? '✅' : '⚠️'} {k === 'line' ? 'LINE通知' : 'スプレッドシート'}：{v.message}
              </li>
            ))}
          </ul>
        )}

        <div>
          <label className="text-[11px] font-semibold text-slate-400">通知先Webhook URL（任意・Slack / Discord。https のみ。見込み客・要人間対応が来たときに通知）</label>
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
              {testOut.intent && <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">意図: {testOut.intent}</span>}
              {testOut.leadScore != null && <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">リードスコア: {testOut.leadScore}</span>}
              {testOut.needsHuman && <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300">要人間対応</span>}
              {!testOut.shouldReply && <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">返信しない判定</span>}
            </div>
            <p className="text-sm text-slate-200 whitespace-pre-wrap">{testOut.reply || '（返信なし）'}</p>
            {testOut.note && <p className="text-[11px] text-slate-400">{testOut.note}</p>}
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
