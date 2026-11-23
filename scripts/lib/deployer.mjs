/**
 * Cloud Run への自動デプロイ（npm run deploy の中身）。
 *
 * 手順書にあった「APIの有効化・バケット作成・権限付与・長い gcloud コマンド・env.yaml 作成・
 * APP_URL の設定・LINE の Webhook 登録」をまとめて実行する。
 *
 * gcloud の実行は `run` を差し替えられるようにしてあり、テストでは実際には実行しない。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Cloud Run に渡さない環境変数（Cloud Run が自動で設定するもの・コンテナ側で決めるもの） */
const EXCLUDED_ENV = new Set(['PORT', 'DATA_DIR', 'NODE_ENV', 'APP_URL', 'K_SERVICE', 'K_REVISION', 'K_CONFIGURATION']);

/** 有効化が必要な Google Cloud の API */
export const REQUIRED_APIS = [
  'run.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'storage.googleapis.com',
];

export class DeployError extends Error {}

/**
 * Cloud Run に渡す環境変数を .env の内容から作る（空の値・除外キーは渡さない）。
 * @param {Record<string, string>} env parseEnv した .env
 * @param {string} [appUrl] 公開URL（分かっていれば APP_URL として渡す）
 * @returns {Record<string, string>}
 */
export function buildRunEnv(env, appUrl) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (!v || EXCLUDED_ENV.has(k)) continue;
    out[k] = v;
  }
  if (appUrl) out.APP_URL = appUrl;
  return out;
}

/** 環境変数を gcloud の --env-vars-file 用 YAML にする（値は JSON 文字列＝YAML としても正しい） */
export function toEnvYaml(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`)
    .join('\n') + '\n';
}

/**
 * プロジェクトID（と会社名）からデータ保存用バケット名を決める。
 * @param {string} project Google Cloud のプロジェクトID
 * @param {string} [customer] 会社名（省略時は自分用の `data`）
 * @example
 * bucketNameFor('my-proj');         // 'my-proj-leadgen-data'
 * bucketNameFor('my-proj', 'acme'); // 'my-proj-leadgen-acme'
 */
export const bucketNameFor = (project, customer) => `${project}-leadgen-${customer || 'data'}`.toLowerCase();

/** 会社名から Cloud Run のサービス名を決める（省略時は自分用の leadgen-agent） */
export const serviceNameFor = (customer) => (customer ? `leadgen-${customer}` : 'leadgen-agent');

/**
 * デプロイを実行する。
 *
 * @param {object} o
 * @param {(args: string[], opt?: { capture?: boolean, allowFail?: boolean }) => { code: number, stdout: string, stderr: string }} o.run gcloud 実行関数
 * @param {Record<string, string>} o.env    parseEnv した .env
 * @param {string} o.root                   リポジトリのルート（--source に渡す）
 * @param {string} [o.region]               既定 asia-northeast1（東京）
 * @param {string} [o.customer]             会社名（導入代行用。サービス名・バケット名がお客様ごとに分かれる）
 * @param {string} [o.project]              使う Google Cloud プロジェクトID（省略時は gcloud で選択中のもの）
 * @param {string} [o.service]              サービス名（省略時は会社名から自動で決まる）
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(s: string) => void} [o.log]
 * @param {number} [o.healthTries]          動作確認の試行回数（既定 20 回 × 3 秒）
 * @returns {Promise<{ url: string, bucket: string, project: string, region: string, service: string, line: null | { ok: boolean, active: boolean | null, message: string } }>}
 */
export async function deploy(o) {
  const log = o.log || console.log;
  const region = o.region || 'asia-northeast1';
  const service = o.service || serviceNameFor(o.customer);
  const fetchImpl = o.fetchImpl || fetch;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const gc = (args, opt = {}) => {
    const r = o.run(args, opt);
    if (r.code !== 0 && !opt.allowFail) {
      throw new DeployError(`gcloud ${args.slice(0, 3).join(' ')} が失敗しました。\n${(r.stderr || r.stdout || '').trim().slice(-800)}`);
    }
    return r;
  };
  const out = (args) => gc(args, { capture: true }).stdout.trim();

  // ---- 0. 事前チェック ----
  log('\n① 事前チェック');
  if (o.run(['--version'], { capture: true, allowFail: true }).code !== 0) {
    throw new DeployError(
      'gcloud（Google Cloud CLI）が見つかりません。\n  インストール: https://cloud.google.com/sdk/docs/install\n  インストール後、ターミナルを開き直してから npm run deploy を実行してください。'
    );
  }
  const account = gc(['config', 'get-value', 'account'], { capture: true, allowFail: true }).stdout.trim();
  if (!account || account === '(unset)') throw new DeployError('Google アカウントでログインしていません。次を実行してください:\n  gcloud auth login');
  const project = (o.project || gc(['config', 'get-value', 'project'], { capture: true, allowFail: true }).stdout.trim()).trim();
  if (!project || project === '(unset)') {
    throw new DeployError('使う Google Cloud プロジェクトが選ばれていません。次を実行してください（IDはコンソールの上部で確認）:\n  gcloud config set project あなたのプロジェクトID');
  }
  const setupCmd = o.customer ? `npm run setup ${o.customer}` : 'npm run setup';
  const envName = o.customer ? `customers/${o.customer}.env` : '.env';
  if (!o.env.GEMINI_API_KEY) throw new DeployError(`${envName} に GEMINI_API_KEY がありません。先に ${setupCmd} を実行してください。`);
  if (!o.env.ADMIN_TOKEN || o.env.ADMIN_TOKEN.length < 16) throw new DeployError(`${envName} に ADMIN_TOKEN がありません。先に ${setupCmd} を実行してください。`);
  log(`  ✅ アカウント: ${account}`);
  log(`  ✅ プロジェクト: ${project}（リージョン: ${region}）`);
  if (o.customer) log(`  ✅ お客様: ${o.customer}（サービス名: ${service}）`);

  // ---- 1. API の有効化 ----
  log('\n② 必要な機能（API）を有効化しています…（初回は1〜2分かかります）');
  const en = gc(['services', 'enable', ...REQUIRED_APIS, '--project', project], { allowFail: true });
  if (en.code !== 0) {
    throw new DeployError(
      `API を有効化できませんでした。次を確認してください。\n  ・プロジェクトID「${project}」が正しいか\n  ・今ログインしているアカウント（${account}）に、そのプロジェクトの「オーナー」権限があるか\n  ・Google Cloud コンソールの「お支払い」で、そのプロジェクトに請求先アカウント（課金）が設定されているか`
    );
  }
  log('  ✅ 有効化しました');

  // ---- 2. データ保存用バケット ----
  const bucket = bucketNameFor(project, o.customer);
  log(`\n③ データ保存用のバケット（gs://${bucket}）`);
  if (gc(['storage', 'buckets', 'describe', `gs://${bucket}`, '--format=value(name)', '--project', project], { capture: true, allowFail: true }).code === 0) {
    log('  ✅ 作成済みのものを使います');
  } else {
    gc(['storage', 'buckets', 'create', `gs://${bucket}`, '--location', region, '--uniform-bucket-level-access', '--project', project]);
    log('  ✅ 作成しました');
  }
  // Cloud Run（既定のサービスアカウント）がバケットを読み書きできるようにする
  const projectNumber = out(['projects', 'describe', project, '--format=value(projectNumber)']);
  const grant = gc(
    [
      'storage', 'buckets', 'add-iam-policy-binding', `gs://${bucket}`,
      `--member=serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`,
      '--role=roles/storage.objectUser', '--project', project,
    ],
    { capture: true, allowFail: true }
  );
  log(grant.code === 0 ? '  ✅ アプリからの読み書きを許可しました' : '  ⚠️ 読み書きの許可を設定できませんでした（既定の権限で動く場合はそのままで問題ありません）');

  // ---- 3. 既存のサービス情報 ----
  const desc = gc(['run', 'services', 'describe', service, '--region', region, '--project', project, '--format=json'], { capture: true, allowFail: true });
  let existingUrl = '';
  let hasVolume = false;
  if (desc.code === 0) {
    try {
      const j = JSON.parse(desc.stdout);
      existingUrl = j?.status?.url || '';
      hasVolume = (j?.spec?.template?.spec?.volumes || []).some((v) => v?.name === 'data');
    } catch {
      /* 解析できなければ初回扱い */
    }
  }

  // ---- 4. デプロイ ----
  log(`\n④ アプリを公開しています…（${existingUrl ? '更新' : '初回'}。ビルドに3〜8分ほどかかります）`);
  const vars = buildRunEnv(o.env, existingUrl);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leadgen-')), 'env.yaml');
  fs.writeFileSync(tmp, toEnvYaml(vars), { mode: 0o600 });
  try {
    const args = [
      'run', 'deploy', service,
      '--source', o.root,
      '--region', region,
      '--project', project,
      '--allow-unauthenticated',
      '--max-instances', '1',
      '--no-cpu-throttling',
      '--execution-environment', 'gen2',
      '--env-vars-file', tmp,
      '--quiet',
    ];
    if (!hasVolume) {
      args.push('--add-volume', `name=data,type=cloud-storage,bucket=${bucket}`, '--add-volume-mount', 'volume=data,mount-path=/data');
    }
    gc(args);
  } finally {
    // キーを含む一時ファイルは必ず消す
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }

  const url = out(['run', 'services', 'describe', service, '--region', region, '--project', project, '--format=value(status.url)']);
  if (!url) throw new DeployError('公開URLを取得できませんでした。Google Cloud コンソールの Cloud Run 画面を確認してください。');
  if (url !== existingUrl) {
    // 初回は公開URLが分からないので、公開後に APP_URL を設定する（LINE通知のリンクなどに使う）
    gc(['run', 'services', 'update', service, '--region', region, '--project', project, '--update-env-vars', `APP_URL=${url}`, '--quiet']);
  }
  log(`  ✅ 公開しました: ${url}`);

  // ---- 5. 動作確認 ----
  log('\n⑤ 動作確認');
  let healthy = false;
  for (let i = 0; i < (o.healthTries ?? 20) && !healthy; i++) {
    try {
      const r = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(10000) });
      healthy = r.ok;
    } catch {
      /* 起動中 */
    }
    if (!healthy) await sleep(3000);
  }
  log(healthy ? '  ✅ アプリは正常に動いています' : '  ⚠️ 応答がありません。数分待ってから URL を開いてください（Cloud Run のログも確認できます）');

  // ---- 6. LINE の Webhook を自動登録 ----
  let line = null;
  if (o.env.LINE_CHANNEL_SECRET && o.env.LINE_CHANNEL_ACCESS_TOKEN && healthy) {
    log('\n⑥ LINE の Webhook を自動設定しています…');
    try {
      const r = await fetchImpl(`${url}/api/admin/line/setup-webhook`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${o.env.ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(60000),
      });
      const d = await r.json().catch(() => ({}));
      line = r.ok ? d.result : { ok: false, active: null, message: d.error || `HTTP ${r.status}` };
    } catch (e) {
      line = { ok: false, active: null, message: e?.message || String(e) };
    }
    log(`  ${line.ok && line.active !== false ? '✅' : '⚠️'} ${line.message}`);
  }

  return { url, bucket, project, region, service, line };
}

/**
 * Windows の cmd.exe 経由で実行するときの引数のクォート。
 * @example quoteWin('--format=value(name)'); // '"--format=value(name)"'
 */
export function quoteWin(arg) {
  return /[\s"&|<>^(),;=]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}
