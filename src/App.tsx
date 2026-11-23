import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  UserCheck,
  Target,
  Send,
  Copy,
  Check,
  MessageSquare,
  TrendingUp,
  Video,
  Share2,
  Image as ImageIcon,
  Layers,
  Award,
  ArrowRight,
  RefreshCw,
  Sliders,
  Zap,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Play,
  Users,
  Briefcase,
  ExternalLink,
  Bot,
  Wand2,
  Smartphone,
  Eye,
  Download,
  Bookmark,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import AutoReply from './AutoReply.tsx';
import { postJson } from './apiClient.ts';

// --- プリセット・テンプレート定義 ---
interface PersonaTemplate {
  id: string;
  badge: string;
  name: string;
  handle: string;
  role: string;
  avatarEmoji: string;
  defaultAvatarUrl: string;
  visualStyle: string;
  tone: string;
  relationToBoss: string;
  sampleHook: string;
}

const PERSONA_TEMPLATES: PersonaTemplate[] = [
  {
    id: 'pr_secretary',
    badge: '王道・高信頼',
    name: '九条 レイ (27)',
    handle: '@rei_dx_secretary',
    role: 'DX・経営戦略室の敏腕AI広報秘書',
    avatarEmoji: '👩‍💼',
    defaultAvatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=80',
    visualStyle: '洗練されたネイビーのビジネススーツ、知的で親しみやすい笑顔、モダンな東京のオフィス背景、フォトリアルな日本人女性',
    tone: '丁寧だが核心を突くスマートな敬語。「うちの代表（ボス）がいつも言っているのですが…」が口癖。',
    relationToBoss: 'ボス（ユーザー）の公式AI広報秘書。プロフィールや投稿で「〇〇公式のAI広報」と明示したうえで、ボスの実績や考え方を紹介し、「一度うちのボスの壁打ちを受けてみてください」と自然に案内する。',
    sampleHook: 'うちのボス（公式AI広報の私の雇い主です）がよく言うのが「AI導入はツール選びから始めると失敗する」ということ。その理由を3つ紹介します。'
  },
  {
    id: 'apprentice',
    badge: '共感・拡散型',
    name: 'ミナト (24)',
    handle: '@minato_biz_ai',
    role: 'ゼロから経営とAIを学ぶ実践チャレンジャー',
    avatarEmoji: '🧑‍💻',
    defaultAvatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    visualStyle: 'スマートカジュアルなパーカーとジャケット、カフェやコワーキングスペースでMacBookを開く若手起業家風、明るいライティング',
    tone: '熱量が高くフレンドリー。「師匠の教えをAIの私がかみくだいて解説するね！」という学習レポート口調。',
    relationToBoss: 'ボス（ユーザー）公式のAI解説キャラ。実在の弟子や利用者のふりはせず、ボスのノウハウを初心者目線でわかりやすく解説し、「もっと詳しく知りたい人は師匠の無料セミナーへ」と案内する。',
    sampleHook: '師匠がいつも言う「業務の9割はAIに任せられる」って本当？公式AIの僕が、その考え方をわかりやすく解説するね。'
  },
  {
    id: 'analyst',
    badge: '権威・B2B特化',
    name: 'Dr. クロノス',
    handle: '@dr_chronos_ai',
    role: '2030年から来たAI経営アナリスト',
    avatarEmoji: '🕶️',
    defaultAvatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
    visualStyle: '未来的でスタイリッシュなダークスーツ、ホログラムのデータパネルが浮かぶダークネイビーのスタジオ、知的でクールなビジュアル',
    tone: '論理的で少し辛口なデータ主義。数字は出典があるものだけを使い、「よくある勘違いを整理します」とバッサリ切る。',
    relationToBoss: 'ボス（ユーザー）公式のAIアナリストキャラ。中立の評論家を装わず、ボスの公式キャラであると明示したうえで、業界のよくある誤解を整理し、ボスの考え方と相談窓口を紹介する。',
    sampleHook: '「とりあえずChatGPT研修」で終わっている企業が見落としがちな3つのポイントを整理します。'
  },
  {
    id: 'navigator',
    badge: '親近感・中堅企業向け',
    name: '咲良 (さくら)',
    handle: '@sakura_work_dx',
    role: '中小企業の現場を救う業務改善ナビゲーター',
    avatarEmoji: '🌸',
    defaultAvatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=600&q=80',
    visualStyle: '清潔感のある白ブラウスとベージュのジャケット、明るい自然光が入るオフィス、安心感を与える柔和な表情の日本人女性',
    tone: '寄り添い型でわかりやすい解説。「難しいIT用語は使いません！」「現場がラクになる方法だけお伝えしますね」',
    relationToBoss: 'ボス（ユーザー）公式のAI窓口コンシェルジュ。経営者や現場の悩みに深く共感し、「よろしければ、うちの代表に直接相談してみませんか」とハードルを下げて個別相談へ案内する。',
    sampleHook: '「うちはアナログな会社だからAIなんて無理…」って諦めていませんか？実は、パソコンが苦手な社員さんほど喜ぶ方法があるんです！'
  }
];

const STRATEGY_PATTERNS = [
  {
    id: 'problem_to_boss',
    title: '課題提起 ➔ ボス（俺）の解決策へ誘導',
    desc: '業界のよくある失敗を指摘し、「うちのボスならこう解決する」と権威付けして誘導'
  },
  {
    id: 'case_study',
    title: '劇的ビフォーアフター実績 ➔ 無料相談誘導',
    desc: '具体的な数字や改善事例をストーリーで語り、「同じ悩みを解決したい方はボスへ」と誘導'
  },
  {
    id: 'insider_secret',
    title: '業界の裏話・ホンネ暴露 ➔ LINE/特典誘導',
    desc: '普通は言えない本音をAIキャラが代弁し、クローズドな場（LINEや資料）へリストインさせる'
  },
  {
    id: 'qa_style',
    title: '「ボスに聞いてみた」対談・Q&A形式',
    desc: 'フォロワーの疑問をAIがボスにぶつけ、その鮮やかな回答でファン化させる'
  }
];

const THEME_SUGGESTIONS = [
  '中小企業のAI・DX導入が9割失敗する本当の理由',
  '補助金・助成金頼みの経営が危険なワケと正しい投資先',
  'ベテラン社員の暗黙知をAI化して売上を1.5倍にした事例',
  '社長自身がプレイヤーから抜け出せない会社の末路',
  '最新のAIエージェントでバックオフィス業務を80%削減した裏側',
  '「ChatGPTを全社導入したけど誰も使わない」現象の解決法'
];

/** DM誘導シミュレーターの1メッセージ（system は画面表示のみで、AIには送らない） */
interface DmMsg {
  sender: 'prospect' | 'influencer' | 'system';
  text: string;
  /** AIの判定結果（見込み度など）の表示用 */
  meta?: string;
}

/**
 * localStorage から JSON を読む（壊れている・使えない場合は null）。
 * @example const boss = loadJson<Record<string, string>>('ai_leadgen_boss');
 */
function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** localStorage に JSON を保存する（プライベートモード等で失敗しても無視） */
function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

const BOSS_STORAGE_KEY = 'ai_leadgen_boss';
const PERSONA_STORAGE_KEY = 'ai_leadgen_persona';

export default function App() {
  const [activeTab, setActiveTab] = useState<'studio' | 'persona' | 'dm_sim' | 'auto' | 'funnel'>('studio');

  // 1. ボス（ユーザー自身）＆集客ゴール設定
  const [bossProfile, setBossProfile] = useState(() => {
    const saved = loadJson<Record<string, string>>(BOSS_STORAGE_KEY);
    if (saved && typeof saved === 'object') return saved;
    return {
      bossName: 'あなた（代表・エグゼクティブコンサルタント）',
      bossTitle: 'AI×経営改革ストラテジスト',
      bossStrength: '現場に定着するAI導入と、机上の空論ではない泥臭い利益改善。支援実績100社以上。',
      targetAudience: '年商1億〜30億円規模の中小企業経営者・次世代アトツギ・役員クラス',
      ctaGoal: '毎月5社限定の「AI経営・収益倍増60分無料壁打ち（個別相談）」への申込',
      ctaLinkText: 'プロフィールの公式LINEから「壁打ち」と送信してください'
    };
  });

  // 2. AIインフルエンサー・ペルソナ設定
  // 編集内容はブラウザに自動保存し、再読み込みしても消えないようにする
  const savedPersona = loadJson<PersonaTemplate>(PERSONA_STORAGE_KEY);
  const initialPersona: PersonaTemplate =
    savedPersona && typeof savedPersona === 'object' && savedPersona.name
      ? { ...(PERSONA_TEMPLATES.find((t) => t.id === savedPersona.id) || PERSONA_TEMPLATES[0]), ...savedPersona }
      : PERSONA_TEMPLATES[0];
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialPersona.id);
  const [persona, setPersona] = useState<PersonaTemplate>(initialPersona);

  useEffect(() => {
    saveJson(PERSONA_STORAGE_KEY, persona);
  }, [persona]);
  useEffect(() => {
    saveJson(BOSS_STORAGE_KEY, bossProfile);
  }, [bossProfile]);

  // AIアバター生成用ステート
  const [generatedAvatarUrl, setGeneratedAvatarUrl] = useState<string | null>(initialPersona.defaultAvatarUrl);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  // 3. コンテンツ生成用ステート
  const [themeInput, setThemeInput] = useState(initialPersona.sampleHook);
  const [selectedStrategy, setSelectedStrategy] = useState(STRATEGY_PATTERNS[0].id);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [contentError, setContentError] = useState('');
  const [previewMode, setPreviewMode] = useState<'cards' | 'phone_feed'>('cards');
  const [activeCarouselSlide, setActiveCarouselSlide] = useState(0);

  // 初期表示のサンプル。実績・数字は【 】のプレースホルダーにしてあり、実際の事例に差し替えて使う
  const [generatedPack, setGeneratedPack] = useState({
    xThread: [
      '【公式AI広報の九条です】うちのボスがよく言うのが「AI導入はツール選びから始めると失敗する」ということ。今日はその理由を紹介します。（1/4）',
      '多くの会社が「とりあえず最新ツールを入れること」を目的にしてしまいます。でもボス曰く、「業務フローの整理なしにAIを入れるのは、散らかった部屋にルンバを放つのと同じ」だと。（2/4）',
      'ボスが支援先でまずやるのは「止める業務」を3つ決めること。【ここに実際の支援事例と、確認済みの数字を入れる】（3/4）',
      '「うちの会社、どこから手をつければいい？」と迷っている経営者様へ。うちのボス（AI×経営改革ストラテジスト）が【60分の無料壁打ち】を行っています。プロフィールの公式LINEから「壁打ち」と送ってください。（4/4）'
    ],
    shortVideo: {
      hook: '（カメラに向かって）「AI導入、ツール選びから始めていませんか？」',
      body: 'こんにちは、公式AI広報の九条です。うちのボスがいつも言うのは、AI化が失敗する原因は「ツール選び」から始めること。ボスはまず「やめる業務」を3つ決めます。【ここに実際の事例を入れる】',
      cta: '「自社の場合はどうすれば？」と思った社長様、一度うちのボスの無料壁打ちを使ってみませんか？詳細はプロフィールのリンクから！',
      visualDirection: 'オフィス背景で九条レイが資料を持ちながら語りかける。画面の隅に「AI広報キャラクター」と常時表示。途中に図解テロップ「×ツール導入 ➔ ◎業務の断捨離」を大きく表示。'
    },
    carousel: [
      { slide: 1, title: 'AI導入でつまずく会社の共通点', detail: '公式AI広報が、うちのボスが現場で見てきた「やってはいけないDX」を紹介します。' },
      { slide: 2, title: '失敗原因：散らかった部屋にルンバを放つな', detail: '業務フローが属人化したままAIを入れても、現場が混乱して誰も使わなくなります。' },
      { slide: 3, title: 'ボス流の解決策：まず「やめる業務」を3つ決める', detail: 'AI化の前に業務の断捨離。AIが機能する土台をつくります。' },
      { slide: 4, title: '支援事例', detail: '【ここに実際の支援事例と、確認済みの数字を入れる】' },
      { slide: 5, title: 'うちのボスに相談してみませんか？', detail: '60分の無料壁打ち相談を受付中。プロフィールの公式LINEから「壁打ち」と送信してください！' }
    ],
    imagePromptEn: 'A photorealistic portrait of a smart 27-year-old Japanese female PR secretary named Rei, wearing a tailored navy business suit, holding a tablet in a modern Tokyo high-rise office, warm cinematic lighting, confident and friendly smile, 8k resolution, corporate executive photography',
    imagePromptJa: '東京のモダンな高層オフィスでタブレットを持つ、ネイビーのスーツを着た知的で親しみやすい27歳の日本人女性広報秘書（九条レイ）。シネマティックな照明、信頼感のある笑顔、8Kフォトリアル'
  });

  // 4. DM・コメント自動誘導シミュレーター用ステート
  const [dmHistory, setDmHistory] = useState<DmMsg[]>([
    {
      sender: 'prospect',
      text: 'いつも投稿見てます！うちの会社もAI導入したいんですが、社員がアナログすぎて何から始めればいいか分からなくて…'
    },
    {
      sender: 'influencer',
      text: 'コメントありがとうございます！九条です😊\n「社員さんがアナログで定着しない」というお悩み、実はうちのボスの元にも一番多く寄せられるご相談なんです。\n\nちなみに現在、社内で一番「これに時間を取られているな…」と感じる業務はどんな作業でしょうか？'
    }
  ]);
  const [dmInput, setDmInput] = useState('');
  const dmListRef = useRef<HTMLDivElement>(null);
  const [isSimulatingDm, setIsSimulatingDm] = useState(false);

  // 5. ファネル試算シミュレーター用ステート
  const [funnelMetrics, setFunnelMetrics] = useState({
    postsPerWeek: 14,
    avgViewsPerPost: 3500,
    profileClickRate: 2.5, // %
    lineConversionRate: 15.0, // %
    consultationBookingRate: 20.0, // %
    closeRate: 30.0, // %
    ltvPerClient: 120 // 万円
  });

  // コピー＆保存ステート
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveSettings = () => {
    saveJson(BOSS_STORAGE_KEY, bossProfile);
    saveJson(PERSONA_STORAGE_KEY, persona);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  // テンプレート切り替え
  const handleSelectTemplate = (tpl: PersonaTemplate) => {
    setSelectedTemplateId(tpl.id);
    setPersona(tpl);
    setThemeInput(tpl.sampleHook);
    setGeneratedAvatarUrl(tpl.defaultAvatarUrl);
  };

  // --- サーバー側 Gemini エンドポイント経由でアバター画像生成 ---
  const handleGenerateAvatar = async () => {
    setIsGeneratingAvatar(true);
    setAvatarError('');

    try {
      const data = await postJson('/api/generate-avatar', { persona });
      if (data.imageUrl) {
        setGeneratedAvatarUrl(data.imageUrl);
      } else {
        // Fallback: keep current or default high quality image
        setGeneratedAvatarUrl(persona.defaultAvatarUrl);
      }
    } catch (e: any) {
      setAvatarError(`画像生成に失敗しました（${e.message}）。プリセット画像を表示しています。`);
      setGeneratedAvatarUrl(persona.defaultAvatarUrl);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  // --- マルチチャネル集客コンテンツ一括生成 (サーバー側 Gemini API) ---
  const handleGenerateContentPack = async () => {
    if (!themeInput.trim()) return;
    setIsGeneratingContent(true);
    setContentError('');

    const strategyObj = STRATEGY_PATTERNS.find(s => s.id === selectedStrategy);

    try {
      const result = await postJson('/api/generate-content', {
        persona,
        bossProfile,
        themeInput,
        strategyTitle: strategyObj?.title,
        strategyDesc: strategyObj?.desc
      });
      if (result && result.xThread) {
        setGeneratedPack(result);
        setActiveCarouselSlide(0);
      } else {
        throw new Error('Invalid format returned');
      }
    } catch (e: any) {
      console.error(e);
      setContentError(`コンテンツの生成に失敗しました：${e.message}`);
    } finally {
      setIsGeneratingContent(false);
    }
  };

  // --- DM・コメント誘導シミュレーター応答生成 ---
  const handleSendDm = async (customText: string | null = null) => {
    const messageToSend = customText || dmInput;
    if (!messageToSend.trim() || isSimulatingDm) return;

    const updatedHistory: DmMsg[] = [...dmHistory, { sender: 'prospect', text: messageToSend }];
    setDmHistory(updatedHistory);
    if (!customText) setDmInput('');
    setIsSimulatingDm(true);

    try {
      // 本番のLINE自動返信と同じ判定・プロンプトで返信案を作る（system メッセージはAIに送らない）
      const data = await postJson('/api/chat-dm', {
        history: updatedHistory.filter((m) => m.sender !== 'system'),
        persona,
        bossProfile,
      });
      const meta = [
        data.leadScore != null ? `見込み度 ${data.leadScore}` : '',
        data.intent ? `意図: ${data.intent}` : '',
      ]
        .filter(Boolean)
        .join(' ／ ');
      const next: DmMsg[] = [...updatedHistory];
      if (data.reply) next.push({ sender: 'influencer', text: data.reply, meta });
      if (data.status !== 'reply') {
        next.push({
          sender: 'system',
          text: data.status === 'needs_human' ? `🙋 要人間対応：${data.note}` : `⏭ ${data.note || '返信しない判定'}`,
        });
      }
      setDmHistory(next);
    } catch (e: any) {
      // 失敗時に定型文を「AIの返信」として見せると品質確認を誤るので、エラーと明示する（AIには送らない）
      setDmHistory([...updatedHistory, { sender: 'system', text: `⚠️ 返信の生成に失敗しました：${e.message}` }]);
    } finally {
      setIsSimulatingDm(false);
    }
  };

  // 新しいメッセージが来たら、チャット欄を一番下までスクロールする
  useEffect(() => {
    const el = dmListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dmHistory, isSimulatingDm, activeTab]);

  // 全コンテンツのMarkdownダウンロード
  const handleDownloadMarkdown = () => {
    const md = `# ${persona.name} × ${bossProfile.bossTitle} 集客コンテンツセット

## 1. X (Twitter) 4連スレッド
${generatedPack.xThread.map((p, i) => `### Post ${i + 1}\n${p}`).join('\n\n')}

---

## 2. ショート動画台本 (TikTok / Reels / YouTube Shorts)
**【冒頭フック (0-3s)】**
${generatedPack.shortVideo.hook}

**【本編 (3-45s)】**
${generatedPack.shortVideo.body}

**【誘導CTA (45-60s)】**
${generatedPack.shortVideo.cta}

**【演出・テロップ指示】**
${generatedPack.shortVideo.visualDirection}

---

## 3. カルーセル図解構成 (5枚)
${generatedPack.carousel.map(c => `### Slide ${c.slide}: ${c.title}\n${c.detail}`).join('\n\n')}

---

## 4. AIインフルエンサー画像生成プロンプト
**英語:**
\`\`\`
${generatedPack.imagePromptEn}
\`\`\`

**日本語解説:**
${generatedPack.imagePromptJa}
`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leadgen_pack_${persona.id}_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ファネル計算
  const monthlyImpressions = funnelMetrics.postsPerWeek * 4 * funnelMetrics.avgViewsPerPost;
  const monthlyProfileClicks = Math.round(monthlyImpressions * (funnelMetrics.profileClickRate / 100));
  const monthlyLeads = Math.round(monthlyProfileClicks * (funnelMetrics.lineConversionRate / 100));
  const monthlyConsultations = Math.round(monthlyLeads * (funnelMetrics.consultationBookingRate / 100));
  const monthlyDeals = (monthlyConsultations * (funnelMetrics.closeRate / 100)).toFixed(1);
  const estimatedMonthlyRevenue = Math.round(Number(monthlyDeals) * funnelMetrics.ltvPerClient);
  const estimatedAnnualRevenue = estimatedMonthlyRevenue * 12;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* トップヘッダー */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Bot className="w-6 h-6 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  AI Influencer <span className="text-amber-400">Lead-Gen Agent</span>
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  「俺を集客する」広報AI構築スタジオ
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                あなた公式のAI広報キャラが専門性を伝え、24時間自動で見込み客を案内します
              </p>
            </div>
          </div>

          {/* ナビゲーションタブ */}
          <nav className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            <button
              onClick={() => setActiveTab('studio')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'studio'
                  ? 'bg-amber-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>集客コンテンツ生成</span>
            </button>
            <button
              onClick={() => setActiveTab('persona')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'persona'
                  ? 'bg-amber-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>AIキャラ＆ボス設定</span>
            </button>
            <button
              onClick={() => setActiveTab('dm_sim')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'dm_sim'
                  ? 'bg-amber-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>DM誘導シミュレーター</span>
            </button>
            <button
              onClick={() => setActiveTab('auto')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'auto'
                  ? 'bg-amber-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>自動返信（API連携）</span>
            </button>
            <button
              onClick={() => setActiveTab('funnel')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'funnel'
                  ? 'bg-amber-500 text-slate-950 shadow-sm font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>集客ROI試算</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 現在のAIインフルエンサー ➔ ボス誘導ファネルのステータスバー */}
        <div className="mb-6 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="relative shrink-0">
                {generatedAvatarUrl ? (
                  <img
                    src={generatedAvatarUrl}
                    alt={persona.name}
                    className="w-14 h-14 rounded-2xl object-cover border-2 border-amber-500/60 shadow-md"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl">
                    {persona.avatarEmoji}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-900 shadow" title="稼働準備完了"></span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                    稼働中のAIスポークスパーソン
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    {persona.role}
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">
                  {persona.name} <span className="text-slate-400 font-normal text-sm">があなた（{bossProfile.bossTitle}）の魅力を代弁・集客中</span>
                </h2>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-slate-300">
                <Share2 className="w-3.5 h-3.5 text-blue-400" />
                <span>SNSで課題提起</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              <div className="flex items-center gap-1.5 text-slate-300">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                <span>公式AI広報がボスを紹介</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold truncate max-w-[180px]">
                <Target className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{bossProfile.ctaGoal}</span>
              </div>
              <button
                onClick={() => setActiveTab('persona')}
                className="ml-auto lg:ml-2 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                設定変更
              </button>
            </div>
          </div>
        </div>

        {/* ==================== TAB 1: 集客コンテンツ自動生成スタジオ ==================== */}
        {activeTab === 'studio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 左カラム：キャラクター選択＆テーマ入力 */}
            <div className="lg:col-span-5 space-y-5">
              {/* Step 1: どのAIキャラに喋らせるか */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold">1</span>
                    AIインフルエンサーを選択
                  </h3>
                  <button
                    onClick={() => setActiveTab('persona')}
                    className="text-xs text-amber-400 hover:underline flex items-center gap-1"
                  >
                    細かくカスタマイズ <ChevronRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {PERSONA_TEMPLATES.map((tpl) => {
                    const isSelected = selectedTemplateId === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        onClick={() => handleSelectTemplate(tpl)}
                        className={`text-left p-3 rounded-xl border transition-all relative overflow-hidden ${
                          isSelected
                            ? 'bg-amber-500/10 border-amber-500/60 shadow-md shadow-amber-500/5 ring-1 ring-amber-500/30'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <img
                            src={tpl.defaultAvatarUrl}
                            alt={tpl.name}
                            className="w-8 h-8 rounded-full object-cover border border-slate-700"
                          />
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            isSelected ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {tpl.badge}
                          </span>
                        </div>
                        <div className="font-bold text-xs text-white truncate">{tpl.name}</div>
                        <div className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{tpl.role}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: 誘導ロジックと発信テーマ */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold">2</span>
                  「あなた」へ誘導する戦略パターンとネタ
                </h3>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    集客導線パターン（どうやってあなたを推薦するか）
                  </label>
                  <div className="space-y-2">
                    {STRATEGY_PATTERNS.map((st) => (
                      <label
                        key={st.id}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
                          selectedStrategy === st.id
                            ? 'bg-blue-500/10 border-blue-500/50 text-white'
                            : 'bg-slate-950/50 border-slate-800/80 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="strategy"
                          checked={selectedStrategy === st.id}
                          onChange={() => setSelectedStrategy(st.id)}
                          className="mt-1 accent-amber-500"
                        />
                        <div>
                          <div className="text-xs font-bold">{st.title}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{st.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-400">
                      今回発信するテーマ・エピソード・言いたいこと
                    </label>
                  </div>
                  <textarea
                    rows={3}
                    value={themeInput}
                    onChange={(e) => setThemeInput(e.target.value)}
                    placeholder="例：うちのボスが支援先で無駄な会議をAIで減らした実際の事例（数字は確認済みのものだけ）..."
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-500 focus:outline-none p-3 text-sm text-white placeholder-slate-600 transition-colors"
                  />
                  {/* ワンクリック・テーマ候補 */}
                  <div className="mt-2">
                    <span className="text-[11px] text-slate-500 block mb-1">💡 クリックでテーマ例を挿入:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {THEME_SUGGESTIONS.map((sug, i) => (
                        <button
                          key={i}
                          onClick={() => setThemeInput(sug)}
                          className="text-[11px] px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition-colors text-left"
                        >
                          + {sug.slice(0, 20)}...
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {contentError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{contentError}</span>
                  </div>
                )}

                <button
                  onClick={handleGenerateContentPack}
                  disabled={isGeneratingContent}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 active:scale-[0.99]"
                >
                  {isGeneratingContent ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{persona.name}の視点で集客コンテンツを構築中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>マルチチャネル集客コンテンツを一括生成</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 右カラム：生成されたマルチチャネル・コンテンツ出力 */}
            <div className="lg:col-span-7 space-y-5">
              {/* ツールバー：プレビュー切り替え＆Markdown一括エクスポート */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-2.5 rounded-2xl">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-400">表示モード:</span>
                  <button
                    onClick={() => setPreviewMode('cards')}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      previewMode === 'cards' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    エディタ表示
                  </button>
                  <button
                    onClick={() => setPreviewMode('phone_feed')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      previewMode === 'phone_feed' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>SNS実機プレビュー</span>
                  </button>
                </div>

                <button
                  onClick={handleDownloadMarkdown}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-amber-400" />
                  <span>セット全体をMarkdownでDL</span>
                </button>
              </div>

              {previewMode === 'phone_feed' ? (
                /* SNS実機プレビュー */
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center">
                  <div className="w-full max-w-sm rounded-[32px] border-4 border-slate-700 bg-black p-4 shadow-2xl relative overflow-hidden">
                    <div className="w-24 h-4 bg-slate-800 rounded-full mx-auto mb-4"></div>
                    
                    {/* X Feed Mockup */}
                    <div className="space-y-4 text-xs">
                      <div className="flex items-start gap-2.5 border-b border-slate-900 pb-3">
                        <img
                          src={generatedAvatarUrl || persona.defaultAvatarUrl}
                          alt={persona.name}
                          className="w-9 h-9 rounded-full object-cover border border-amber-500/40"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-white text-xs">{persona.name}</span>
                            <span className="text-[10px] text-blue-400">✓</span>
                            <span className="text-[10px] text-slate-500">{persona.handle}</span>
                          </div>
                          <p className="text-slate-200 text-xs mt-1 leading-relaxed whitespace-pre-wrap">
                            {generatedPack.xThread[0]}
                          </p>
                          <div className="mt-2 rounded-xl overflow-hidden border border-slate-800">
                            <img
                              src={generatedAvatarUrl || persona.defaultAvatarUrl}
                              alt="Post visual"
                              className="w-full h-36 object-cover"
                            />
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-slate-500 mt-2.5 px-1">
                            <span>💬 28</span>
                            <span>🔄 114</span>
                            <span>❤️ 482</span>
                            <span>📊 14.8K</span>
                          </div>
                        </div>
                      </div>

                      {/* CTA Post Preview */}
                      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                        <div className="text-[10px] font-bold text-amber-400 mb-1">【ボスへの誘導CTA部分】</div>
                        <p className="text-[11px] text-slate-300">
                          {generatedPack.xThread[generatedPack.xThread.length - 1]}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-3">
                    ※ 読者にはAIインフルエンサーの公式投稿として表示され、自然にあなたの権威とサービスへ誘導されます
                  </p>
                </div>
              ) : (
                /* 通常エディタ表示 */
                <>
                  {/* 1. X (Twitter) 集客スレッド */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-bold text-xs">
                          X (Twitter) 4連スレッド
                        </span>
                        <span className="text-xs text-slate-400 hidden sm:inline">
                          教育 ➔ ボスの権威付け ➔ LINE/相談誘導
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopy(generatedPack.xThread.join('\n\n---\n\n'), 'x_all')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
                      >
                        {copiedKey === 'x_all' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>スレッド全文コピー</span>
                      </button>
                    </div>

                    <div className="space-y-3">
                      {generatedPack.xThread.map((post, idx) => (
                        <div
                          key={idx}
                          className="relative p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/90 hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 mb-1.5">
                              <img
                                src={generatedAvatarUrl || persona.defaultAvatarUrl}
                                alt={persona.name}
                                className="w-5 h-5 rounded-full object-cover"
                              />
                              <span className="text-xs font-bold text-white">{persona.name}</span>
                              <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                {idx === 0 ? '① フック' : idx === generatedPack.xThread.length - 1 ? '④ ボスへ誘導CTA' : `②〜③ 価値提供 (${idx + 1}/${generatedPack.xThread.length})`}
                              </span>
                            </div>
                            <button
                              onClick={() => handleCopy(post, `x_${idx}`)}
                              className="text-slate-400 hover:text-white p-1"
                              title="このポストをコピー"
                            >
                              {copiedKey === `x_${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                            {post}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. ショート動画台本 (Reels / TikTok / YouTube Shorts) */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4 text-rose-400" />
                        <h3 className="text-sm font-bold text-white">
                          ショート動画台本（TikTok / Reels / Shorts）
                        </h3>
                      </div>
                      <button
                        onClick={() =>
                          handleCopy(
                            `【冒頭フック】\n${generatedPack.shortVideo.hook}\n\n【本編】\n${generatedPack.shortVideo.body}\n\n【誘導CTA】\n${generatedPack.shortVideo.cta}\n\n【演出指示】\n${generatedPack.shortVideo.visualDirection}`,
                            'video_script'
                          )
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
                      >
                        {copiedKey === 'video_script' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>台本をコピー</span>
                      </button>
                    </div>

                    <div className="space-y-3 text-xs sm:text-sm">
                      <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
                        <span className="text-[11px] font-bold text-rose-400 uppercase block mb-1">
                          0:00 - 0:03 冒頭フック（スクロール停止）
                        </span>
                        <p className="text-white font-semibold">{generatedPack.shortVideo.hook}</p>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                        <span className="text-[11px] font-bold text-blue-400 uppercase block mb-1">
                          0:03 - 0:45 本編ストーリー（ボスのノウハウ・事例紹介）
                        </span>
                        <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{generatedPack.shortVideo.body}</p>
                      </div>

                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                        <span className="text-[11px] font-bold text-emerald-400 uppercase block mb-1">
                          0:45 - 0:60 クロージングCTA（ボスへの相談誘導）
                        </span>
                        <p className="text-white font-medium">{generatedPack.shortVideo.cta}</p>
                      </div>

                      <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400">
                        <span className="font-semibold text-slate-300">🎬 映像・テロップ演出メモ：</span> {generatedPack.shortVideo.visualDirection}
                      </div>
                    </div>
                  </div>

                  {/* 3. Instagram / LinkedIn カルーセル構成 ＆ AI画像生成プロンプト */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* カルーセル */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-amber-400" />
                            <h3 className="text-sm font-bold text-white">5枚組カルーセル図解</h3>
                          </div>
                          <button
                            onClick={() =>
                              handleCopy(
                                generatedPack.carousel.map(c => `Slide ${c.slide}: ${c.title}\n${c.detail}`).join('\n\n'),
                                'carousel_copy'
                              )
                            }
                            className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                          >
                            {copiedKey === 'carousel_copy' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>コピー</span>
                          </button>
                        </div>

                        {/* カルーセルインタラクティブスライド表示 */}
                        {generatedPack.carousel[activeCarouselSlide] && (
                          <div className="p-4 rounded-xl bg-gradient-to-br from-slate-950 to-slate-900 border border-amber-500/30 mb-3 shadow-inner">
                            <div className="flex justify-between items-center text-xs text-amber-400 font-bold mb-2">
                              <span>SLIDE {activeCarouselSlide + 1} / {generatedPack.carousel.length}</span>
                              <span className="text-[10px] text-slate-400">Instagram / LinkedIn</span>
                            </div>
                            <div className="text-sm font-bold text-white mb-1.5">
                              {generatedPack.carousel[activeCarouselSlide].title}
                            </div>
                            <div className="text-xs text-slate-300 leading-relaxed">
                              {generatedPack.carousel[activeCarouselSlide].detail}
                            </div>
                          </div>
                        )}

                        {/* スライドインジケーター */}
                        <div className="flex items-center justify-between pt-1">
                          <button
                            onClick={() => setActiveCarouselSlide(s => Math.max(0, s - 1))}
                            disabled={activeCarouselSlide === 0}
                            className="p-1 rounded-lg bg-slate-800 disabled:opacity-40 text-slate-300 hover:text-white"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <div className="flex gap-1.5">
                            {generatedPack.carousel.map((_, i) => (
                              <button
                                key={i}
                                onClick={() => setActiveCarouselSlide(i)}
                                className={`w-2 h-2 rounded-full transition-all ${
                                  activeCarouselSlide === i ? 'bg-amber-400 w-5' : 'bg-slate-700'
                                }`}
                              />
                            ))}
                          </div>
                          <button
                            onClick={() => setActiveCarouselSlide(s => Math.min(generatedPack.carousel.length - 1, s + 1))}
                            disabled={activeCarouselSlide === generatedPack.carousel.length - 1}
                            className="p-1 rounded-lg bg-slate-800 disabled:opacity-40 text-slate-300 hover:text-white"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5 mt-3 pt-3 border-t border-slate-800/80">
                        {generatedPack.carousel.map((item, idx) => (
                          <div
                            key={item.slide}
                            onClick={() => setActiveCarouselSlide(idx)}
                            className={`p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                              activeCarouselSlide === idx
                                ? 'bg-amber-500/10 border border-amber-500/40 text-white'
                                : 'bg-slate-950/60 border border-slate-800/60 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <span className="font-bold text-amber-400 mr-1.5">#{item.slide}</span>
                            <span>{item.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* AIビジュアル＆プロンプト */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <ImageIcon className="w-4 h-4 text-purple-400" />
                            <h3 className="text-sm font-bold text-white">AIインフルエンサー画像生成</h3>
                          </div>
                          <button
                            onClick={() => handleCopy(generatedPack.imagePromptEn, 'img_prompt')}
                            className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                          >
                            {copiedKey === 'img_prompt' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>英語プロンプト</span>
                          </button>
                        </div>

                        {generatedAvatarUrl ? (
                          <div className="mb-3 relative group rounded-xl overflow-hidden border border-slate-700">
                            <img
                              src={generatedAvatarUrl}
                              alt="AI Influencer Avatar"
                              className="w-full h-44 object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-3">
                              <span className="text-xs font-semibold text-white drop-shadow">
                                {persona.name}（{persona.role}）
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="mb-3 h-36 rounded-xl bg-slate-950 border border-dashed border-slate-800 flex flex-col items-center justify-center p-4 text-center">
                            <span className="text-2xl mb-1">{persona.avatarEmoji}</span>
                            <p className="text-xs text-slate-400">
                              下のボタンでこのAIインフルエンサーのリアルな宣材アバターを生成できます
                            </p>
                          </div>
                        )}

                        <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono line-clamp-3 mb-2">
                          {generatedPack.imagePromptEn}
                        </div>
                        <p className="text-[11px] text-slate-400 mb-3">
                          {generatedPack.imagePromptJa}
                        </p>
                      </div>

                      {avatarError && (
                        <p className="text-xs text-red-400 mb-2">{avatarError}</p>
                      )}

                      <button
                        onClick={handleGenerateAvatar}
                        disabled={isGeneratingAvatar}
                        className="w-full py-2.5 px-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                      >
                        {isGeneratingAvatar ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>AIインフルエンサー画像を生成中...</span>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>このキャラのビジュアルをAI生成・更新</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB 2: AIキャラ＆ボス（あなた）の設計 ==================== */}
        {activeTab === 'persona' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ボス（ユーザー自身）の定義 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <Briefcase className="w-5 h-5 text-amber-400" />
                  <div>
                    <h3 className="text-base font-bold text-white">1. 集客したい「ボス（あなた自身）」の定義</h3>
                    <p className="text-xs text-slate-400">AIインフルエンサーが誰を褒め、どこへ見込み客を送り込むかを設定します</p>
                  </div>
                </div>
                {savedSuccess && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 保存完了
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">あなたの呼称・肩書き</label>
                  <input
                    type="text"
                    value={bossProfile.bossTitle}
                    onChange={(e) => setBossProfile({ ...bossProfile, bossTitle: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    あなたの強み・専門性・実績（AIが投稿内で自慢するポイント）
                  </label>
                  <textarea
                    rows={3}
                    value={bossProfile.bossStrength}
                    onChange={(e) => setBossProfile({ ...bossProfile, bossStrength: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">集めたいターゲット顧客層</label>
                  <input
                    type="text"
                    value={bossProfile.targetAudience}
                    onChange={(e) => setBossProfile({ ...bossProfile, targetAudience: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-amber-400 mb-1">
                    最終コンバージョン（集客ゴール・オファー内容）
                  </label>
                  <input
                    type="text"
                    value={bossProfile.ctaGoal}
                    onChange={(e) => setBossProfile({ ...bossProfile, ctaGoal: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-amber-500/40 p-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">具体的な誘導アクション文言</label>
                  <input
                    type="text"
                    value={bossProfile.ctaLinkText}
                    onChange={(e) => setBossProfile({ ...bossProfile, ctaLinkText: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={handleSaveSettings}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                    <span>設定をブラウザに保存</span>
                  </button>
                </div>
              </div>
            </div>

            {/* AIインフルエンサーのカスタマイズ */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
                <UserCheck className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-base font-bold text-white">2. AIインフルエンサーの人格・関係性カスタマイズ</h3>
                  <p className="text-xs text-slate-400">公式AI広報がボスを紹介すると、自慢っぽくならずに伝わります（公式キャラであることは明示します）</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">AIキャラの名前</label>
                    <input
                      type="text"
                      value={persona.name}
                      onChange={(e) => setPersona({ ...persona, name: e.target.value })}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">肩書き・ポジション</label>
                    <input
                      type="text"
                      value={persona.role}
                      onChange={(e) => setPersona({ ...persona, role: e.target.value })}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">話し方のトーン＆口癖</label>
                  <textarea
                    rows={2}
                    value={persona.tone}
                    onChange={(e) => setPersona({ ...persona, tone: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-amber-400 mb-1">
                    あなた（ボス）との関係性・紹介ロジック
                  </label>
                  <textarea
                    rows={3}
                    value={persona.relationToBoss}
                    onChange={(e) => setPersona({ ...persona, relationToBoss: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-amber-500/40 p-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">外見・ビジュアル設定（画像生成と連動）</label>
                  <textarea
                    rows={2}
                    value={persona.visualStyle}
                    onChange={(e) => setPersona({ ...persona, visualStyle: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => setActiveTab('studio')}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-colors"
                  >
                    <span>この設定でコンテンツ生成へ戻る</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: DM・コメント自動誘導シミュレーター ==================== */}
        {activeTab === 'dm_sim' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-400" />
                DM・コメント誘導シミュレーター
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                SNSの投稿を見たフォロワー（見込み客）からコメントやDMが来た際、<strong>{persona.name}</strong>がどのように会話を温め、売り込み感ゼロで<strong>あなた（ボス）の個別相談へパスを出すか</strong>をテストできます。
              </p>
              <p className="text-[11px] text-emerald-300/90 leading-relaxed">
                ✅ 本番のLINE自動返信と同じ判定・同じ指示で返信を作ります（人間対応キーワードやAI明示の文言も反映）。ここで確認した品質が、そのまま本番の品質です。
              </p>

              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-slate-300 block">
                  💬 よくある見込み客の反応をワンクリック送信:
                </span>
                {[
                  'うちは年商5億の製造業なんですが、そんな現場でもAIって使えますか？',
                  'ボスの方の無料壁打ちって、まだ具体的な導入予定がなくても申し込んで大丈夫ですか？',
                  '以前コンサルを入れて失敗したことがあって…他と何が違うんでしょうか？',
                  '社内にITに詳しい社員が一人もいないのですが大丈夫でしょうか？'
                ].map((sampleMsg, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendDm(sampleMsg)}
                    disabled={isSimulatingDm}
                    className="w-full text-left p-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 transition-colors"
                  >
                    「{sampleMsg}」
                  </button>
                ))}
              </div>
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col h-[560px] shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <img
                    src={generatedAvatarUrl || persona.defaultAvatarUrl}
                    alt={persona.name}
                    className="w-8 h-8 rounded-full object-cover border border-amber-500/40"
                  />
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      <span>{persona.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        自動返信AIエージェント
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-400">誘導先: {bossProfile.ctaGoal}</div>
                  </div>
                </div>
                <button
                  onClick={() => setDmHistory(dmHistory.slice(0, 2))}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  会話をリセット
                </button>
              </div>

              {/* チャット履歴 */}
              <div ref={dmListRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
                {dmHistory.map((msg, i) => msg.sender === 'system' ? (
                  <div key={i} className="flex justify-center">
                    <div className="max-w-[90%] rounded-xl px-3 py-2 text-[11px] text-slate-300 bg-slate-800/60 border border-slate-700 whitespace-pre-wrap">
                      {msg.text}
                    </div>
                  </div>
                ) : (
                  <div
                    key={i}
                    className={`flex ${msg.sender === 'prospect' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.sender === 'prospect'
                          ? 'bg-blue-600 text-white rounded-br-none shadow-md'
                          : 'bg-slate-950 border border-slate-800 text-slate-200 rounded-bl-none shadow-md'
                      }`}
                    >
                      <div className="text-[10px] opacity-75 mb-1 font-semibold flex items-center gap-1">
                        {msg.sender === 'prospect' ? (
                          '見込み客（フォロワー）'
                        ) : (
                          <>
                            <span className="text-amber-400">★</span> {persona.name}（AI広報秘書）
                          </>
                        )}
                      </div>
                      {msg.text}
                      {msg.meta && <div className="mt-2 text-[10px] text-amber-300/80">{msg.meta}</div>}
                    </div>
                  </div>
                ))}
                {isSimulatingDm && (
                  <div className="flex justify-start">
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs text-slate-400 flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                      <span>{persona.name}がボスへ繋ぐ最適な返信を作成中...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 入力欄 */}
              <div className="mt-4 pt-3 border-t border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={dmInput}
                  onChange={(e) => setDmInput(e.target.value)}
                  onKeyDown={(e) => {
                    // 日本語入力の変換確定（Enter）では送信しない
                    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    handleSendDm();
                  }}
                  placeholder="見込み客として質問や悩みを入力してみてください..."
                  className="flex-1 rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={() => handleSendDm()}
                  disabled={isSimulatingDm || !dmInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  <span>送信</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: 週間運用＆集客ファネルROI試算 ==================== */}
        {activeTab === 'auto' && <AutoReply persona={persona} bossProfile={bossProfile} />}

        {activeTab === 'funnel' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-amber-400" />
                AIインフルエンサー運用パラメータ
              </h3>
              <p className="text-xs text-slate-400">
                AIインフルエンサーが毎日投稿を継続した場合に、毎月あなたのもとへ何件の個別相談・成約が入るかをシミュレーションします。
              </p>

              <div className="space-y-4 pt-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">週あたりのAI投稿数（X + ショート動画）</span>
                    <span className="font-bold text-amber-400">{funnelMetrics.postsPerWeek} 本 / 週</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="35"
                    value={funnelMetrics.postsPerWeek}
                    onChange={(e) => setFunnelMetrics({ ...funnelMetrics, postsPerWeek: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">1投稿あたりの平均インプレッション/再生数</span>
                    <span className="font-bold text-amber-400">{funnelMetrics.avgViewsPerPost.toLocaleString()} 回</span>
                  </div>
                  <input
                    type="range"
                    min="500"
                    max="20000"
                    step="500"
                    value={funnelMetrics.avgViewsPerPost}
                    onChange={(e) => setFunnelMetrics({ ...funnelMetrics, avgViewsPerPost: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">プロフィール・LP遷移率</span>
                    <span className="font-bold text-amber-400">{funnelMetrics.profileClickRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="5.0"
                    step="0.5"
                    value={funnelMetrics.profileClickRate}
                    onChange={(e) => setFunnelMetrics({ ...funnelMetrics, profileClickRate: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">公式LINE / メルマガ登録率</span>
                    <span className="font-bold text-amber-400">{funnelMetrics.lineConversionRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="40"
                    step="1"
                    value={funnelMetrics.lineConversionRate}
                    onChange={(e) => setFunnelMetrics({ ...funnelMetrics, lineConversionRate: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">個別相談 ➔ 成約率</span>
                    <span className="font-bold text-blue-400">{funnelMetrics.closeRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="70"
                    step="5"
                    value={funnelMetrics.closeRate}
                    onChange={(e) => setFunnelMetrics({ ...funnelMetrics, closeRate: Number(e.target.value) })}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">あなたの平均契約単価（LTV）</span>
                    <span className="font-bold text-emerald-400">{funnelMetrics.ltvPerClient} 万円</span>
                  </div>
                  <input
                    type="range"
                    min="30"
                    max="500"
                    step="10"
                    value={funnelMetrics.ltvPerClient}
                    onChange={(e) => setFunnelMetrics({ ...funnelMetrics, ltvPerClient: Number(e.target.value) })}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
              <div>
                <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  月間リード獲得＆売上インパクト予測
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[11px] text-slate-400">月間総リーチ数</div>
                    <div className="text-lg font-bold text-white mt-1">
                      {monthlyImpressions.toLocaleString()} <span className="text-xs font-normal text-slate-400">imp</span>
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[11px] text-slate-400">プロフアクセス</div>
                    <div className="text-lg font-bold text-blue-400 mt-1">
                      {monthlyProfileClicks.toLocaleString()} <span className="text-xs font-normal text-slate-400">人</span>
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="text-[11px] text-slate-400">新規LINEリスト獲得</div>
                    <div className="text-lg font-bold text-amber-400 mt-1">
                      {monthlyLeads.toLocaleString()} <span className="text-xs font-normal text-slate-400">件/月</span>
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/40">
                    <div className="text-[11px] text-emerald-400 font-semibold">あなたへの個別相談</div>
                    <div className="text-lg font-bold text-emerald-400 mt-1">
                      {monthlyConsultations} <span className="text-xs font-normal">社/月</span>
                    </div>
                  </div>
                </div>

                {/* なぜ自分で発信するよりAIインフルエンサーなのか？ */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-slate-950 to-slate-950 border border-amber-500/30 space-y-2 mb-4">
                  <div className="text-xs font-bold text-amber-400">
                    💡 なぜ「自分」ではなく「AI広報キャラ」に集客させるのか？
                  </div>
                  <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
                    <li>
                      <strong>自慢っぽくならない紹介：</strong> 自分で「私は凄いです」と言うより、公式AI広報の{persona.name}がボスの考え方や実績を紹介する方が、受け手に伝わりやすくなります。※第三者を装うとステマ規制の対象になるため、「公式AI広報」であることは必ず明示してください。
                    </li>
                    <li>
                      <strong>あなたの時間を奪わない：</strong> 顔出し撮影や日々のSNS運用はAIキャラに任せ、あなたは最後の「濃い見込み客との60分壁打ち」だけに集中できます。
                    </li>
                    <li>
                      <strong>24時間体制の自動ファネル：</strong> 見込み客がいつ接触しても、AIキャラが丁寧にヒアリングしてあなたのLINEや予約カレンダーへと案内します。
                    </li>
                  </ul>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-emerald-300 block">AIインフルエンサー経由の想定月間受注額（成約率{funnelMetrics.closeRate}%想定）</span>
                  <div className="text-2xl sm:text-3xl font-extrabold text-white mt-0.5">
                    月間 +{estimatedMonthlyRevenue.toLocaleString()} <span className="text-base font-normal text-emerald-300">万円（約 {monthlyDeals} 社成約）</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    年間想定インパクト: <strong className="text-emerald-400">+{estimatedAnnualRevenue.toLocaleString()} 万円 / 年</strong>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('studio')}
                  className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shrink-0 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>今日の投稿を作る</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
