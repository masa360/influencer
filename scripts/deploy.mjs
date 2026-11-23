#!/usr/bin/env node
/**
 * Cloud Run への自動デプロイ（npm run deploy）
 *
 * 事前に必要なのは次の3つだけ（手順書 STEP 3）:
 *   1. Google Cloud CLI（gcloud）のインストール
 *   2. gcloud auth login
 *   3. gcloud config set project あなたのプロジェクトID
 *
 * 使い方:
 *   npm run deploy           自分用（.env の内容を公開）
 *   npm run deploy acme      お客様「acme」用（customers/acme.env の内容を公開）
 *   npm run deploy all       登録済みのお客様すべてを順番に公開（コードを更新したときに使う）
 *
 * 何度実行してもよい（設定を変えたら再実行すると反映される）。
 * オプション（環境変数）: DEPLOY_REGION（既定 asia-northeast1）
 *
 * @example
 *   npm run deploy acme
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './lib/envfile.mjs';
import { deploy, DeployError, quoteWin } from './lib/deployer.mjs';
import { CustomerError, customerPaths, listCustomers, parseTarget, readMeta, writeMeta } from './lib/customers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

/**
 * 1つの対象（自分用 or お客様1社）を公開する。
 * @param {string} customer 会社名（自分用は空文字）
 */
async function deployOne(customer) {
  const envPath = customer ? customerPaths(root, customer).env : path.join(root, '.env');
  const envLabel = customer ? `customers/${customer}.env` : '.env';
  if (!fs.existsSync(envPath)) {
    throw new DeployError(`${envLabel} がありません。先に ${customer ? `npm run setup ${customer}` : 'npm run setup'} を実行してください。`);
  }
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const meta = customer ? readMeta(root, customer) : {};

  const r = await deploy({
    run,
    env,
    root,
    customer: customer || undefined,
    project: meta.project || undefined,
    region: process.env.DEPLOY_REGION || meta.region || undefined,
  });

  if (customer) {
    writeMeta(root, customer, {
      project: r.project,
      region: r.region,
      service: r.service,
      bucket: r.bucket,
      url: r.url,
      deployedAt: new Date().toISOString(),
    });
  }
  return { r, env };
}

/** 公開後に表示する「残りの手作業」 */
function printRemaining({ r, env }, customer) {
  console.log(`\n================ 公開が完了しました${customer ? `（お客様: ${customer}）` : ''} ================`);
  console.log(`  アプリのURL: ${r.url}`);
  console.log(`  管理トークン: ${customer ? `customers/${customer}.env の ADMIN_TOKEN の値（お客様には別の連絡手段で渡す）` : '.env の ADMIN_TOKEN の値（画面で聞かれたら貼り付け）'}`);
  console.log('\n  残りの手作業:');
  let n = 1;
  if (r.line) {
    if (r.line.active === false) console.log(`   ${n++}. LINE Developers →「Messaging API設定」→「Webhookの利用」をオン`);
    console.log(`   ${n++}. LINE Official Account Manager →「設定」→「応答設定」→「応答メッセージ」をオフ（まだの場合）`);
    console.log(`   ${n++}. アプリの「自動返信」タブ → ボス情報を入れて「現在の設定をサーバーに反映」→「登録コードを発行」→ 担当者のLINEから送って通知先に登録`);
  } else if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.log(`   ${n++}. LINE を使うときは: ${customer ? `npm run setup ${customer}` : 'npm run setup'} で LINE のキーを入れて、もう一度 ${customer ? `npm run deploy ${customer}` : 'npm run deploy'}`);
  }
  if (customer) console.log(`   ${n++}. お客様に docs/CUSTOMER_GUIDE.md と、アプリのURL・管理トークンを渡す`);
  else console.log(`   ${n++}. Google Cloud コンソール →「お支払い」→「予算とアラート」で予算アラートを設定（おすすめ）`);
  console.log('');
}

async function main() {
  const target = parseTarget(process.argv.slice(2));
  console.log('==============================================');
  console.log(
    target.kind === 'all'
      ? '  Cloud Run へ公開（登録済みのお客様すべて）'
      : target.kind === 'customer'
        ? `  Cloud Run へ公開（お客様: ${target.name}）`
        : '  Cloud Run へ公開（npm run deploy）'
  );
  console.log('==============================================');

  if (target.kind === 'default') return printRemaining(await deployOne(''), '');
  if (target.kind === 'customer') return printRemaining(await deployOne(target.name), target.name);

  // ---- all: 1社ずつ順番に。1社が失敗しても、残りは続ける ----
  const customers = listCustomers(root);
  if (!customers.length) throw new CustomerError('登録済みのお客様がいません。先に npm run setup 会社名 で追加してください。');
  console.log(`  対象: ${customers.map((c) => c.name).join(', ')}（${customers.length}社。1社あたり数分かかります）`);
  const results = [];
  for (const [i, c] of customers.entries()) {
    console.log(`\n########## [${i + 1}/${customers.length}] ${c.name} ##########`);
    try {
      const out = await deployOne(c.name);
      results.push({ name: c.name, ok: true, url: out.r.url, line: out.r.line });
    } catch (e) {
      console.error(`\n❌ ${c.name}: ${e.message}\n`);
      results.push({ name: c.name, ok: false, error: String(e.message).split('\n')[0] });
    }
  }
  console.log('\n================ まとめ ================');
  for (const r of results) {
    console.log(r.ok ? `  ✅ ${r.name}: ${r.url}${r.line && !r.line.ok ? '（⚠️ LINE の接続テストを確認）' : ''}` : `  ❌ ${r.name}: ${r.error}`);
  }
  console.log('');
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  if (e instanceof DeployError || e instanceof CustomerError) {
    console.error(`\n❌ ${e.message}\n`);
  } else {
    console.error('\n❌ 想定外のエラーが発生しました:', e?.stack || e);
  }
  process.exit(1);
});
