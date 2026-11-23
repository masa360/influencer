#!/usr/bin/env node
/**
 * 初期設定ウィザード（npm run setup）
 *
 * 質問に答えてキーを貼り付けるだけで .env を作る。何度実行してもよい（設定済みの項目は Enter でそのまま）。
 *   1. .env を作る（なければ .env.example からコピー）
 *      ※ 導入代行では「npm run setup 会社名」で、お客様専用の customers/会社名.env に保存する
 *   2. 管理画面の合言葉 ADMIN_TOKEN を自動で作る
 *   3. Gemini の API キーを入力 → 使えるか・アプリのモデルが使えるかを確認
 *   4. （任意）LINE のキーを入力 → 公式アカウントに接続できるか確認
 *
 * @example
 *   npm run setup           自分用（.env）
 *   npm run setup acme      お客様「acme」用（customers/acme.env）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseEnv, setEnv } from './lib/envfile.mjs';
import { CustomerError, customerPaths, parseTarget, readMeta, writeMeta } from './lib/customers.mjs';
import { checkGeminiKey, checkLineToken, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL, looksLikeLineSecret } from './lib/checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = path.join(root, '.env.example');

// 対象: 自分用（.env）か、お客様用（customers/会社名.env）か
let target;
try {
  target = parseTarget(process.argv.slice(2));
  if (target.kind === 'all') throw new CustomerError('setup は1社ずつ実行します。会社名を指定してください（例: npm run setup acme）。');
} catch (e) {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
}
const customer = target.kind === 'customer' ? target.name : '';
const envPath = customer ? customerPaths(root, customer).env : path.join(root, '.env');
const envLabel = customer ? `customers/${customer}.env` : '.env';
const setupCmd = customer ? `npm run setup ${customer}` : 'npm run setup';

const c = {
  ok: (s) => console.log(`  ✅ ${s}`),
  warn: (s) => console.log(`  ⚠️  ${s}`),
  ng: (s) => console.log(`  ❌ ${s}`),
  info: (s) => console.log(`     ${s}`),
  head: (s) => console.log(`\n${s}`),
};
/** キーの一部だけ見せる（画面に全部出さない） */
const mask = (v) => (v.length <= 8 ? '****' : `${v.slice(0, 4)}…${v.slice(-4)}`);

async function main() {
  console.log('==============================================');
  console.log(customer ? `  初期設定ウィザード（お客様: ${customer}）` : '  初期設定ウィザード（npm run setup）');
  console.log('  ※ 設定済みの項目は、何も入力せず Enter でそのまま');
  console.log('==============================================');

  // ---- 1. .env ----
  c.head(`① 設定ファイル（${envLabel}）`);
  if (!fs.existsSync(envPath)) {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '', { mode: 0o600 });
    c.ok(`${envLabel} を作成しました`);
  } else {
    c.ok(`既存の ${envLabel} を使います`);
  }
  if (customer) c.info('※ このファイルにはお客様の鍵が入ります。GitHub・サーバーには上げません（自動で除外済み）。');
  let text = fs.readFileSync(envPath, 'utf8');
  const save = () => fs.writeFileSync(envPath, text, { mode: 0o600 });
  const get = (k) => parseEnv(text)[k] || '';
  const set = (k, v) => {
    text = setEnv(text, k, v);
    save();
  };

  // 入力の受け取り（まとめて貼り付けた複数行や、入力の終了にも対応）
  const rl = readline.createInterface({ input: stdin, output: stdout });
  /** 確認結果（まとめの表示用）: ok / ng / unverified / missing */
  const status = { gemini: 'missing', line: 'missing' };
  const queue = [];
  let waiting = null;
  let closed = false;
  rl.on('line', (line) => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(line);
    } else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w('');
    }
  });
  rl.on('SIGINT', () => {
    console.log('\n\n中断しました（ここまでの入力は .env に保存済みです）');
    process.exit(130);
  });
  /** 質問して1行受け取る（入力が終わっていれば空文字） */
  const ask = (q) => {
    stdout.write(`  → ${q}`);
    if (queue.length) {
      const line = queue.shift();
      stdout.write('\n');
      return Promise.resolve(line.trim());
    }
    if (closed) {
      stdout.write('\n');
      return Promise.resolve('');
    }
    return new Promise((resolve) => (waiting = (line) => resolve(String(line).trim())));
  };

  try {
    // ---- 2. ADMIN_TOKEN ----
    c.head('② 管理画面の合言葉（ADMIN_TOKEN）');
    if (get('ADMIN_TOKEN').length >= 16) {
      c.ok('設定済みです');
    } else {
      set('ADMIN_TOKEN', crypto.randomBytes(32).toString('hex'));
      c.ok(`自動で作成しました（${envLabel} に保存済み）`);
    }
    c.info(customer ? 'お客様のアプリの画面で「管理トークン」を聞かれたら、次の値を貼り付けてもらいます:' : 'アプリの画面で「管理トークン」を聞かれたら、次の値を貼り付けてください:');
    c.info(get('ADMIN_TOKEN'));

    // ---- 3. Gemini ----
    c.head(customer ? '③ Gemini の API キー（お客様のアカウントで取得したもの）' : '③ Gemini の API キー（AIの頭脳）');
    c.info('取得場所: https://aistudio.google.com/apikey →「APIキーを作成」→ コピー');
    if (customer) c.info('※ 料金はキーの持ち主に請求されます。お客様ご自身のキーを使ってください（個人情報を扱うため、有料プランのキーを推奨）。');
    const curGemini = get('GEMINI_API_KEY');
    if (curGemini) c.info(`現在の設定: ${mask(curGemini)}`);
    const inputGemini = await ask(curGemini ? '変更する場合は貼り付けて Enter（そのままなら Enter）: ' : 'キーを貼り付けて Enter: ');
    if (inputGemini) set('GEMINI_API_KEY', inputGemini);
    const gemini = get('GEMINI_API_KEY');
    if (!gemini) {
      c.ng(`未設定です。キーを取得したら、もう一度 ${setupCmd} を実行してください。`);
    } else {
      c.info('確認しています…');
      const textModel = get('GEMINI_MODEL') || DEFAULT_TEXT_MODEL;
      const imageModel = get('GEMINI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL;
      const r = await checkGeminiKey(gemini, { textModel, imageModel });
      status.gemini = r.ok ? 'ok' : r.network ? 'unverified' : 'ng';
      if (!r.ok) {
        (r.network ? c.warn : c.ng)(r.reason);
      } else {
        c.ok('APIキーは使えます');
        if (r.textModelOk) c.ok(`文章用モデル ${textModel} を利用できます`);
        else if (r.suggest.text) {
          c.warn(`文章用モデル ${textModel} はこのキーでは使えません。代わりに ${r.suggest.text} を使うよう設定します`);
          set('GEMINI_MODEL', r.suggest.text);
        } else c.ng(`文章用モデル ${textModel} が使えず、代わりのモデルも見つかりませんでした`);
        if (r.imageModelOk) c.ok(`画像用モデル ${imageModel} を利用できます`);
        else if (r.suggest.image) {
          c.warn(`画像用モデル ${imageModel} は使えません。代わりに ${r.suggest.image} を使うよう設定します`);
          set('GEMINI_IMAGE_MODEL', r.suggest.image);
        } else c.warn('画像用モデルが見つかりませんでした（アバター画像の生成だけ使えません。ほかの機能は使えます）');
      }
    }

    // ---- 4. LINE（任意） ----
    c.head('④ LINE公式アカウント（あとで設定する場合は、そのまま Enter で飛ばせます）');
    c.info('取得場所: https://developers.line.biz/console/ → 該当チャネル');
    c.info('  ・チャネルシークレット …「チャネル基本設定」タブ');
    c.info('  ・チャネルアクセストークン（長期）…「Messaging API設定」タブの一番下で「発行」');
    const curSecret = get('LINE_CHANNEL_SECRET');
    const curToken = get('LINE_CHANNEL_ACCESS_TOKEN');
    if (curSecret || curToken) c.info(`現在の設定: シークレット ${curSecret ? mask(curSecret) : '未設定'} / トークン ${curToken ? mask(curToken) : '未設定'}`);

    const inSecret = await ask('チャネルシークレット: ');
    if (inSecret) {
      if (!looksLikeLineSecret(inSecret)) c.warn('チャネルシークレットは通常32文字の英数字です。トークンと取り違えていないか確認してください（保存はします）');
      set('LINE_CHANNEL_SECRET', inSecret);
    }
    const inToken = await ask('チャネルアクセストークン（長期）: ');
    if (inToken) {
      if (looksLikeLineSecret(inToken)) c.warn('これはチャネルシークレットのようです。トークンは170文字前後の長い文字列です（保存はします）');
      set('LINE_CHANNEL_ACCESS_TOKEN', inToken);
    }
    const token = get('LINE_CHANNEL_ACCESS_TOKEN');
    if (token) {
      const r = await checkLineToken(token);
      status.line = !get('LINE_CHANNEL_SECRET') ? 'ng' : r.ok ? 'ok' : r.network ? 'unverified' : 'ng';
      if (r.ok) c.ok(`公式アカウント「${r.displayName}」（${r.basicId}）に接続できました`);
      else (r.network ? c.warn : c.ng)(r.reason);
      if (!get('LINE_CHANNEL_SECRET')) c.warn('チャネルシークレットが未設定です（受信の確認に必要）');
    } else {
      c.info('LINE はスキップしました（あとで npm run setup をもう一度実行すれば設定できます）');
    }
    // ---- 5. 公開先プロジェクト（導入代行のみ） ----
    if (customer) {
      c.head('⑤ 公開先の Google Cloud プロジェクト');
      c.info('このお客様のアプリを置く Google Cloud のプロジェクトID。空欄のまま Enter なら、いま gcloud で選択中のプロジェクトを使います。');
      const curProject = readMeta(root, customer).project || '';
      if (curProject) c.info(`現在の設定: ${curProject}`);
      const p = await ask('プロジェクトID（そのままなら Enter）: ');
      if (p) {
        if (/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(p)) {
          writeMeta(root, customer, { project: p });
          c.ok(`公開先: ${p}`);
        } else c.warn('プロジェクトIDの形式が違うようです（6〜30文字の小文字・数字・ハイフン。例: my-leadgen-123456）。保存しませんでした');
      }
    }
  } finally {
    rl.close();
  }

  // ---- まとめ ----
  c.head('================ 設定のまとめ ================');
  const show = (label, st, missingText) => {
    if (st === 'ok') c.ok(`${label}: 設定済み・確認OK`);
    else if (st === 'unverified') c.warn(`${label}: 設定済み（ネット接続の問題で確認できず）`);
    else if (st === 'ng') c.ng(`${label}: 確認でエラー（上のメッセージを見て、もう一度 ${setupCmd}）`);
    else (missingText.startsWith('未設定（あとで') ? c.info : c.ng)(`${label}: ${missingText}`);
  };
  show('Gemini の API キー', status.gemini, '未設定（必須）');
  c.ok('管理画面の合言葉: 設定済み');
  show('LINE', status.line, '未設定（あとでOK）');
  if (customer) c.info(`公開先プロジェクト: ${readMeta(root, customer).project || 'gcloud で選択中のもの'}`);
  if (customer) {
    console.log(
      status.gemini === 'ng' || status.gemini === 'missing'
        ? '\n❗ Gemini のキーを直してから公開してください。'
        : `\n次のコマンドで、このお客様のアプリを公開（更新）できます:  npm run deploy ${customer}\n`
    );
  } else {
    console.log(status.gemini === 'ng' || status.gemini === 'missing' ? '\n❗ Gemini のキーを直してから起動してください。' : '\n次のコマンドでアプリを起動できます:  npm run dev');
    console.log('（公開済みの場合は、設定を変えたら npm run deploy で反映）\n');
  }
}

main().catch((e) => {
  console.error('\n❌ 初期設定でエラーが発生しました:', e?.message || e);
  process.exit(1);
});
