#!/usr/bin/env node
/**
 * Cloud Run への自動デプロイ（npm run deploy）
 *
 * 事前に必要なのは次の3つだけ（手順書 STEP 3）:
 *   1. Google Cloud CLI（gcloud）のインストール
 *   2. gcloud auth login
 *   3. gcloud config set project あなたのプロジェクトID
 *
 * .env の内容（npm run setup で作成）をそのまま Cloud Run に設定して公開する。
 * 何度実行してもよい（設定を変えたら再実行すると反映される）。
 *
 * オプション（環境変数）: DEPLOY_REGION（既定 asia-northeast1）, DEPLOY_SERVICE（既定 leadgen-agent）
 *
 * @example
 *   npm run deploy
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './lib/envfile.mjs';
import { deploy, DeployError, quoteWin } from './lib/deployer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const isWin = process.platform === 'win32';

/** gcloud を実行する（capture: 出力を受け取る / それ以外は画面にそのまま表示） */
function run(args, opt = {}) {
  const r = spawnSync('gcloud', isWin ? args.map(quoteWin) : args, {
    cwd: root,
    shell: isWin, // Windows の gcloud は gcloud.cmd のため
    stdio: opt.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.error) return { code: 127, stdout: '', stderr: String(r.error.message) };
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function main() {
  console.log('==============================================');
  console.log('  Cloud Run へ公開（npm run deploy）');
  console.log('==============================================');
  if (!fs.existsSync(envPath)) {
    throw new DeployError('.env がありません。先に npm run setup を実行してください。');
  }
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const r = await deploy({
    run,
    env,
    root,
    region: process.env.DEPLOY_REGION,
    service: process.env.DEPLOY_SERVICE,
  });

  console.log('\n================ 公開が完了しました ================');
  console.log(`  アプリのURL: ${r.url}`);
  console.log(`  管理トークン: .env の ADMIN_TOKEN の値（画面で聞かれたら貼り付け）`);
  console.log('\n  あなたが手でやること（残り）:');
  let n = 1;
  if (r.line) {
    if (r.line.active === false) {
      console.log(`   ${n++}. LINE Developers →「Messaging API設定」→「Webhookの利用」をオン`);
    }
    console.log(`   ${n++}. LINE Official Account Manager →「設定」→「応答設定」→「応答メッセージ」をオフ（まだの場合）`);
    console.log(`   ${n++}. アプリの「自動返信」タブ →「登録コードを発行」→ 自分のLINEから送って通知先に登録`);
  } else if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.log(`   ${n++}. LINE を使うときは: npm run setup で LINE のキーを入れて、もう一度 npm run deploy`);
  }
  console.log(`   ${n++}. Google Cloud コンソール →「お支払い」→「予算とアラート」で予算アラートを設定（おすすめ）`);
  console.log('');
}

main().catch((e) => {
  if (e instanceof DeployError) {
    console.error(`\n❌ ${e.message}\n`);
  } else {
    console.error('\n❌ 想定外のエラーが発生しました:', e?.stack || e);
  }
  process.exit(1);
});
