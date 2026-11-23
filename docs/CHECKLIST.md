# あなたが手でやることチェックリスト

このアプリで **人の手が必要なのは、このページの項目だけ** です。
それ以外（設定ファイルの作成、合言葉づくり、サーバーの準備、LINE の Webhook 登録、通知先の登録、スプレッドシートの合言葉など）は、コマンドやボタンで自動化してあります。

くわしいやり方は、各項目のリンク先（[SETUP_GUIDE.md](SETUP_GUIDE.md)）を見てください。

---

## あなたにしか入れられない情報（7つ）

| # | 入れるもの | どこで手に入る？ | どこに入れる？ |
|---|---|---|---|
| A | Gemini の API キー | [Google AI Studio](https://aistudio.google.com/apikey) | `npm run setup` で貼る |
| B | あなたの情報（名前・肩書き・**本当の**強みと実績・ターゲット・誘導先） | あなた自身 | アプリの「AIキャラ＆ボス設定」タブ |
| C | AIキャラの口調・関係性 | あなた自身 | 同上 |
| D | Google Cloud のプロジェクトID | [Google Cloud コンソール](https://console.cloud.google.com) | `gcloud config set project` で入力 |
| E | LINE のチャネルシークレット | LINE Developers →「チャネル基本設定」 | `npm run setup` で貼る |
| F | LINE のチャネルアクセストークン（長期） | LINE Developers →「Messaging API設定」 | `npm run setup` で貼る |
| G | GAS のウェブアプリURL | Apps Script のデプロイ後に表示 | アプリの「記録用Webhook URL（GAS）」 |

---

## チェックリスト

### 1. パソコンで動かす（30〜60分）→ [STEP 1](SETUP_GUIDE.md#step-1-自分のパソコンで動かす)
- [ ] Node.js（LTS）をインストール
- [ ] GitHub から ZIP をダウンロードして解凍し、ターミナルでそのフォルダに移動
- [ ] `npm install`
- [ ] Google AI Studio で Gemini の API キーを作ってコピー（**A**）
- [ ] `npm run setup` → キーを貼り付け（合言葉は自動で作られる）
- [ ] `npm run dev` → ブラウザで http://localhost:3000 を開く

### 2. あなたの情報を入れて、返信の質を確かめる（1〜2時間）→ [STEP 2](SETUP_GUIDE.md#step-2-あなたの情報を入れて返信の質を確かめる)
- [ ] 「AIキャラ＆ボス設定」で、`【例】` `〇〇` の項目を **すべて** あなたの本当の情報に書き換える（**B**）
- [ ] AIキャラを選び、口調・関係性を調整する（**C**）
- [ ] 「DM誘導シミュレーター」で10往復ほど試し、返信に違和感がないか確認する

### 3. インターネットに公開する（30〜60分）→ [STEP 3](SETUP_GUIDE.md#step-3-インターネットに公開するgoogle-cloud-run)
- [ ] Google Cloud でプロジェクトを作り、課金（請求先アカウント）を有効にする（**D**）
- [ ] Google Cloud CLI（gcloud）をインストール
- [ ] `gcloud auth login`
- [ ] `gcloud config set project あなたのプロジェクトID`
- [ ] `npm run deploy`（表示されたURLを開いて画面が出ればOK）
- [ ] （おすすめ）Google Cloud コンソールで予算アラートを設定

### 4. LINE をつなぐ（30〜60分）→ [STEP 4](SETUP_GUIDE.md#step-4-line-をつなぐ)
- [ ] LINE公式アカウントを作り、「Messaging APIを利用する」をオンにする
- [ ] LINE Developers でチャネルシークレットと、チャネルアクセストークン（長期）をコピー（**E** **F**）
- [ ] `npm run setup` → LINE の2つを貼り付け（公式アカウント名が表示されればOK）
- [ ] `npm run deploy`（Webhook の登録と接続テストは自動）
- [ ] `npm run deploy` が「Webhookの利用をオンに」と表示したら、LINE Developers でオンにする
- [ ] LINE Official Account Manager →「応答設定」→「応答メッセージ」をオフ
- [ ] 手元のアプリで「設定をコピー」→ 公開したアプリで「貼り付けて読み込む」→「自動返信」タブで「現在の設定をサーバーに反映」
- [ ] 同じタブの「登録コードを発行」→ 表示されたメッセージを自分のLINEから公式アカウントに送る

### 5. スプレッドシートに記録する（15分）→ [STEP 5](SETUP_GUIDE.md#step-5-スプレッドシートに記録する)
- [ ] Google スプレッドシートを新しく作る
- [ ] アプリの「GASコードをコピー」→ スプレッドシートの「拡張機能」→「Apps Script」に貼り付けて保存
- [ ] 「デプロイ」→「新しいデプロイ」→ ウェブアプリ（実行：自分／アクセス：全員）→ 承認
- [ ] 表示された URL をアプリの「記録用Webhook URL（GAS）」に貼って「設定を保存」（**G**）
- [ ] 「LINE通知・スプレッドシートにテスト送信」で ✅ が2つ出ることを確認

### 6. 運用を始める → [STEP 6](SETUP_GUIDE.md#step-6-運用を始める)
- [ ] LINE のモードを「下書き（承認制）」にして「設定を保存」→「自動返信を開始する」
- [ ] 1〜2週間、受信ログで返信案を確認して承認する
- [ ] 問題がなければ「全自動」に切り替える
- [ ] SNS のプロフィールに「〇〇公式のAI広報キャラクター」と書く（ステマ規制への配慮）

---

## 困ったら
- ターミナルに出た文字（`❌` や `⚠️` の行）を、そのまま Claude に貼ってください。
- アプリが動いているかの確認：`https://（あなたのアプリのURL）/health` を開いて `{"ok":true}` と出ればOK。
