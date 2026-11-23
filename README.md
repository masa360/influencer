# AI Influencer Lead-Gen Agent

あなた公式のAI広報キャラが専門性を伝え、24時間自動で見込み客を個別相談やLINEへ案内する広報AI構築スタジオ。

> ## はじめての方へ
> **あなたが手でやることは [docs/CHECKLIST.md](docs/CHECKLIST.md) にすべてまとめています。** それ以外は自動化済みです。
> くわしい説明は [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)。

- **コンテンツ生成**（X用の投稿文 / ショート動画 / カルーセル）… 文章を作るだけ（コピペ用）。X との API 連携はしません
- **自動返信** … LINE・LP/HP（＋Instagram / Facebook / YouTube）に届いたメッセージへ、AIキャラが自動で返信
- **通知と記録** … 見込み客・要人間対応・返信エラーを自分のLINEに通知し、全件を Google スプレッドシートに記録

## コマンド

| コマンド | 内容 |
|---|---|
| `npm install` | 部品のインストール（最初に1回） |
| `npm run setup` | 初期設定ウィザード。質問に答えてキーを貼ると `.env` を作成（合言葉は自動生成、キーとAIモデルの利用可否も確認） |
| `npm run dev` | 手元で起動（http://localhost:3000）。起動時に設定チェック `[setup] ✅/⚠️/❌` を表示 |
| `npm run deploy` | Cloud Run に公開／更新（API有効化・保存用バケット・環境変数・公開URL・LINE Webhook 登録まで自動） |
| `npm test` | テスト（Gemini・各SNS API・gcloud はモック） |
| `npm run lint` | 型チェック |

> 自動返信はブラウザを閉じていてもサーバー上で動きます。そのため、AIキャラ／ボス設定は「自動返信」タブの「現在の設定をサーバーに反映」でサーバーに保存されます。

## 自動化している作業

| 以前は手作業だったこと | いまは |
|---|---|
| `.env` の作成・合言葉の生成・キーの確認 | `npm run setup` |
| API有効化・バケット作成・権限付与・`gcloud run deploy`・APP_URL 設定 | `npm run deploy` |
| LINE の Webhook URL 登録と検証 | `npm run deploy`（または画面の「LINEにWebhookを自動設定」） |
| 通知先の LINE ユーザーID を調べて入力 | 画面の「登録コードを発行」→ 自分のLINEから送るだけ |
| GAS コードへの合言葉の記入・URL への `?key=` 付与 | 画面の「GASコードをコピー」／URL を貼るだけ |
| 手元の設定を公開版に入れ直す | 「設定をコピー」→「貼り付けて読み込む」 |

## この版での主な変更（受け取った元の版から）
- X(旧Twitter)連携を外しました（有料APIプランが前提のため）
- 生成API（`/api/generate-content` `/api/chat-dm` `/api/generate-avatar`）も `ADMIN_TOKEN` で保護（Gemini利用料の不正利用対策）
- AIキャラを「運営者公式のAI広報」として明示する設計に変更（ステマ規制対策）。架空の実績・数字を作らない指示を追加し、サンプルのまま使うと警告
- Gemini失敗時に、架空の実績入りテンプレートを返す処理を廃止（エラーとして表示）
- DM誘導シミュレーターを、本番の自動返信と同じ判定・プロンプトで動くように変更（見込み度も表示）
- 返信エラー（Gemini障害・送信失敗）を運営者のLINEに通知（30分に1回まで）
- Cloud Run 対応：`Dockerfile`、停止時のデータ保存、保存の間隔調整と再試行、`/health`
- LINEはグループ・複数人トークの発言に反応しない（1対1のトークのみ）
- `npm install` が失敗する依存関係の不整合（esbuild）を修正、日本語入力の変換確定Enterで誤送信しないよう修正

## 通知と記録（LINE ＋ Google Apps Script）

- **LINE通知**：見込み客（スコアが閾値以上）・要人間対応・返信エラーを、運営者自身のLINE（最大5人）へ multicast で通知します。通知先は画面の「登録コードを発行」→ 自分のLINEから「通知登録 123456」を送るだけで登録できます（コードは10分有効・5回間違えると無効）。
- **スプレッドシート記録**：全受信を、Google Apps Script のウェブアプリ経由でスプレッドシートに記録します（受信時・承認時・却下時に同じIDの行を更新、古い更新では上書きしない）。受け側のコードは [`gas/Code.gs`](gas/Code.gs)（画面の「GASコードをコピー」なら合言葉入り）。
- 画面の「テスト送信」で、両方の設定を実際に送って確認できます。

## 動作の仕組み

```
Instagram / Facebook / LINE ──Webhook──────┐
YouTube ──────────(定期取得)───────────────┤
LP・HP チャット/フォーム ──/api/inbound/web─┼─▶ 共通パイプライン ─▶ Gemini ─▶ 各プラットフォームAPIで返信
Make・Zapier・自社システム ──/api/v1/reply──┘      │
                                                   ├ 重複排除 / 自分の投稿は無視（ループ防止）
                                                   ├ 人間対応キーワード → 「要人間対応」
                                                   ├ レート制限（相手別・全体）
                                                   └ スパム判定 / 下書き(承認制) / 全自動
```

各チャンネルは **オフ / 下書き（承認制） / 全自動** を選べます。最初は「下書き」で返信品質を確認し、問題なければ「全自動」へ。受信ログ画面で、下書きを編集して送信／却下できます。

## チャンネル別の接続手順

| チャンネル | 受信方法 | 登録するURL | 主な環境変数 |
|---|---|---|---|
| Instagram / Facebook | Meta Webhooks | `{APP_URL}/webhooks/meta` | `META_APP_SECRET` `META_VERIFY_TOKEN` `META_PAGE_ACCESS_TOKEN` |
| LINE | Messaging API Webhook | `{APP_URL}/webhooks/line` | `LINE_CHANNEL_SECRET` `LINE_CHANNEL_ACCESS_TOKEN` |
| YouTube | 定期取得（Webhookなし） | ー | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `YOUTUBE_REFRESH_TOKEN` ＋ 画面でチャンネルID |
| LP / HP | ウィジェット or フォーム | ー（画面に貼り付けコードが表示されます） | 画面で「許可するサイトのURL」を設定 |

- **Meta**: アプリに `instagram_manage_messages` / `instagram_manage_comments` / `pages_messaging` / `pages_manage_engagement` などの権限（アプリレビュー）が必要です。Webhookの購読フィールドは `messages`, `comments`（Instagram）／`feed`, `messages`（Page）。
- **YouTube**: 初回は「基準点の保存」だけを行い、過去のコメントには返信しません。`comments.insert` は1回50クォータ（無料枠は1日10,000）なので、返信は1日あたり約150〜200件が上限です。
- **LINE**: 返信は reply API（約25秒以内）、承認後など時間が経った場合は push API（配信数にカウントされます）を使います。

### LP / HP に設置する

画面の「LP / HP」カードを開き、許可するサイトのURLを保存すると、次のようなコードが表示されます。

```html
<script src="https://YOUR_APP/widget.js" data-site-key="pk_xxxxxxxx" async></script>
```

自作フォームから送る場合は `POST /api/inbound/web`（`type: "form"`）。`email` を付け、`RESEND_API_KEY` と `MAIL_FROM` を設定すると返信メールも自動送信されます。

### API（Make / Zapier / n8n など）

```bash
curl -X POST https://YOUR_APP/api/v1/reply \
  -H "Authorization: Bearer <APIキー>" -H "Content-Type: application/json" \
  -d '{"channel":"lp","message":"導入について相談したい","sender":{"id":"user-1","name":"山田","email":"taro@example.com"},"eventId":"任意の一意ID"}'
```

レスポンス: `{ ok, id, status, reply, intent, leadScore, needsHuman, note }`。返信の配信は呼び出し側で行います（チャンネルが「オフ」の場合は 409）。`channel` は `instagram / facebook / youtube / line / web`（`lp` `hp` `form` は `web` の別名）。

## 安全設計（重要）

- **デフォルトは全停止**。全体スイッチ → チャンネル別モード の両方が有効なときだけ返信します。画面上部の「緊急停止」でいつでも止められます。
- **自分の投稿・エコー・スレッド内返信には反応しません**（返信の無限ループ防止）。イベントIDで重複処理も防ぎます。
- **AIであること・運営者公式であることを明記**（既定ON）。コメント返信と初回DMに「（運営者公式のAIアシスタントによる自動返信です）」を付与します。画面で文言を変更できます。「人間ですか？」「関係者ですか？」と聞かれたら、運営者公式のAIだと答えるよう指示しています。
- **「返金」「解約」「クレーム」「弁護士」などは人間対応へ**。AIは返信せず、受信ログに「要人間対応」として残り、Webhook通知（Slack/Discord/Make）も可能です。
- **プロンプトインジェクション対策**。受信メッセージは外部入力として隔離し、システム指示の開示・料金や成果の保証・存在しない実績の作成を禁止しています。ただし完全な防御ではないため、最初は「下書き」運用を推奨します。
- **失敗時に定型文を勝手に送りません**（Gemini障害・未設定時はエラーとして記録）。
- Webhookは**署名検証**（Meta/LINE）、LP/HPは**許可オリジン＋サイトキー＋IPレート制限**、管理API・生成APIは**ADMIN_TOKEN**で保護しています。

## 運用上の注意

- 各プラットフォームの**自動化・ボットに関する規約**（Meta/YouTube/LINE）と、**特定商取引法・景品表示法・個人情報保護法**などの表示・同意要件を事前に確認してください。AIキャラが第三者を装った宣伝（ステルスマーケティング）にならないよう、**SNSのプロフィールにも「〇〇公式のAI広報キャラクター」と明記**してください。
- 設定・受信ログは `DATA_DIR`（既定 `data/db.json`）に保存されます。Cloud Run等はファイルシステムが揮発するため、永続ボリューム（Cloud Storage のマウント）を `DATA_DIR` に指定してください（手順は docs/SETUP_GUIDE.md）。**複数インスタンス構成は未対応**です（単一プロセス前提。Cloud Run では最大インスタンス数を1にしてください）。
- `/api/generate-content` `/api/chat-dm` `/api/generate-avatar` は `ADMIN_TOKEN` で保護されています。画面から初めて使うときに管理トークンの入力を求められます。
