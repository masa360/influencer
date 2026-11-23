import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { registerRoutes, requireAdmin } from './server/routes.ts';
import { startYouTubePoller } from './server/youtube.ts';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Webhookの署名検証には「生のボディ」が必要なので、JSONパース時に保持する
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString('utf8');
    },
  })
);
// Cloud Run / リバースプロキシ配下でクライアントIPを正しく取得（レート制限用）
app.set('trust proxy', 1);

// Shared Gemini client with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// 使用モデル（環境変数で変更可能）
const TEXT_MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';

/** GEMINI_API_KEY 未設定時の共通レスポンス（架空の定型文は返さない） */
function noKey(res: Response) {
  return res.status(503).json({ error: 'GEMINI_API_KEY が未設定です。.env に設定してから再起動してください。' });
}

// 1. Content Generation Endpoint
app.post('/api/generate-content', requireAdmin, async (req: Request, res: Response) => {
  const { persona, bossProfile, themeInput, strategyTitle, strategyDesc } = req.body;

  if (!themeInput || !persona || !bossProfile) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const systemInstruction = `あなたはSNSマーケティングとB2Bリード獲得（集客ファネル設計）のプロフェッショナルです。
ボス（ユーザー自身）の「公式AI広報キャラクター」が発信し、ボスの専門性を伝えて、見込み客をボスの個別相談やLINEへ案内するコンテンツを作成してください。

【AI広報キャラクター設定】
・名前: ${persona.name}
・肩書き: ${persona.role}
・口調・トーン: ${persona.tone}
・ボス（ユーザー）との関係性: ${persona.relationToBoss}
・外見スタイル: ${persona.visualStyle}

【集客したいボス（ユーザー自身）の情報】
・呼称/肩書き: ${bossProfile.bossName} / ${bossProfile.bossTitle}
・ボスの強み・実績: ${bossProfile.bossStrength}
・ターゲット層: ${bossProfile.targetAudience}
・最終コンバージョン（誘導先）: ${bossProfile.ctaGoal}
・誘導アクション: ${bossProfile.ctaLinkText}

【必ず守るルール（ステマ規制・景品表示法への配慮）】
1. このキャラクターはボスが運営する公式のAI広報です。独立した第三者・一般ユーザー・顧客のふりをしない。
2. 投稿の中で、ボスとの関係（公式AI広報・運営者の発信であること）が読み手に伝わる表現にする。
3. 実績・数字・顧客事例は、上の「ボスの強み・実績」に書かれているものだけを使う。書かれていない数字（売上・削減時間・成約率など）や架空の顧客エピソードは作らない。具体例が必要な箇所は【ここに実際の事例を入れる】のようにプレースホルダーにする。
4. 「必ず儲かる」「誰でも成功」など成果を保証する表現や、根拠のない最上級表現（日本一・唯一など）を使わない。`;

  const userPrompt = `以下のテーマと構成パターンで、今すぐSNSに投稿してボスへの集客に繋がるコンテンツ一式を生成してください。

【今回の発信テーマ・フック】
${themeInput}

【採用する誘導構成パターン】
${strategyTitle || '課題提起 ➔ ボスへの解決策誘導'} (${strategyDesc || ''})

各プラットフォームの特性に合わせ、読者が思わず引き込まれ、「そのボス（先生/代表）に相談したい！」と強く感じるストーリーにしてください。`;

  try {
    if (!process.env.GEMINI_API_KEY) return noKey(res);

    const response = await ai.models.generateContent({
      model: TEXT_MODEL(),
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            xThread: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'X（旧Twitter）の4連スレッド投稿。1投稿目は強烈なフック、2-3投稿目は学びとボスの凄さ・事例、4投稿目はボスの無料相談/LINEへの自然なCTA誘導。',
            },
            shortVideo: {
              type: Type.OBJECT,
              properties: {
                hook: { type: Type.STRING, description: '冒頭3秒でスクロールを止めるセリフ' },
                body: { type: Type.STRING, description: '本編のトークスクリプト（30〜45秒想定）' },
                cta: { type: Type.STRING, description: '最後に見込み客をボスへ誘導するクロージングセリフ' },
                visualDirection: { type: Type.STRING, description: 'AI動画生成や編集時の演出・テロップ指示' },
              },
              required: ['hook', 'body', 'cta', 'visualDirection'],
            },
            carousel: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  slide: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['slide', 'title', 'detail'],
              },
              description: 'InstagramやLinkedIn用の5枚組図解カルーセル構成',
            },
            imagePromptEn: {
              type: Type.STRING,
              description: 'AIインフルエンサーのキャラクターを一貫して画像生成するための英語プロンプト',
            },
            imagePromptJa: {
              type: Type.STRING,
              description: '上記画像生成プロンプトの日本語訳・解説',
            },
          },
          required: ['xThread', 'shortVideo', 'carousel', 'imagePromptEn', 'imagePromptJa'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json(parsed);
  } catch (error: any) {
    console.error('Gemini content generation error:', error);
    // 失敗時に架空の実績入りテンプレートを返すと誤って投稿される恐れがあるため、エラーとして返す
    return res.status(502).json({ error: 'コンテンツ生成に失敗しました。時間をおいて再試行してください。' });
  }
});

// 2. DM Simulation Endpoint
app.post('/api/chat-dm', requireAdmin, async (req: Request, res: Response) => {
  const { history, persona, bossProfile } = req.body;

  if (!history || !Array.isArray(history) || !persona || !bossProfile) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const systemInstruction = `あなたは「${persona.name}（${persona.role}）」として、SNSのフォロワー（見込み客）からのコメントやDMに返信するAIエージェントです。
口調: ${persona.tone}
あなたはボスが運営する公式のAIアシスタントです。第三者や一般ユーザーのふりはせず、関係を聞かれたら正直に答えてください。
ボス情報にない実績・数字・料金は作らないでください。
あなたの目的は、売り込み感を一切出さずに相手に共感・ヒアリングしつつ、自然な流れであなたのボスである「${bossProfile.bossTitle}（${bossProfile.bossStrength}）」への個別相談（${bossProfile.ctaGoal} / ${bossProfile.ctaLinkText}）を案内することです。
長すぎず、LINEやDMで読みやすい3〜5行程度の自然な日本語で返信してください。`;

  const conversationContext = history
    .map((m: any) => `${m.sender === 'prospect' ? '見込み客' : persona.name}: ${m.text}`)
    .join('\n');

  const userPrompt = `以下のやり取りの続きとして、${persona.name}からの最適な返信メッセージを作成してください。\n\n${conversationContext}`;

  try {
    if (!process.env.GEMINI_API_KEY) return noKey(res);

    const response = await ai.models.generateContent({
      model: TEXT_MODEL(),
      contents: userPrompt,
      config: {
        systemInstruction,
      },
    });

    return res.json({ reply: response.text || '' });
  } catch (error: any) {
    console.error('DM chat error:', error);
    return res.status(502).json({ error: '返信の生成に失敗しました。時間をおいて再試行してください。' });
  }
});

// 3. Avatar Generation Endpoint
app.post('/api/generate-avatar', requireAdmin, async (req: Request, res: Response) => {
  const { persona } = req.body;
  if (!persona) {
    return res.status(400).json({ error: 'Persona is required' });
  }

  const promptText = `High-end commercial portrait photography of an AI social media influencer: ${persona.visualStyle}. Looking at camera, engaging expression, ultra-detailed, professional corporate lighting, 1:1 aspect ratio.`;

  try {
    if (!process.env.GEMINI_API_KEY) return noKey(res);

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL(),
      contents: {
        parts: [{ text: promptText }],
      },
      config: {
        imageConfig: {
          aspectRatio: '1:1',
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType ?? 'image/png';
        const imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        return res.json({ imageUrl });
      }
    }

    return res.status(500).json({ error: 'Image data not returned' });
  } catch (error: any) {
    console.error('Image generation error:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to generate image',
    });
  }
});

// 自動返信: Webhook / LP・HP用API / 管理API
registerRoutes(app);

// Setup Vite middleware or static serving
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startYouTubePoller();
    if (!process.env.ADMIN_TOKEN) {
      console.warn(
        '[security] ADMIN_TOKEN が未設定です。管理画面・生成API・管理APIは、開発モードのローカル接続からのみ利用できます。本番では必ず設定してください。'
      );
    }
  });
}

startServer();
