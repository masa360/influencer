/**
 * npm run setup / npm run deploy の中身のテスト（ネットワーク・gcloud は使わない）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// スクリプトは素の JavaScript（.mjs）なので、テストでは型を緩めて扱う
const envfile: any = await import('../scripts/lib/envfile.mjs');
const checks: any = await import('../scripts/lib/checks.mjs');
const deployer: any = await import('../scripts/lib/deployer.mjs');

// ============================================================ .env の読み書き

test('.env: 読み込み（クォート・コメント・仮の値）', () => {
  const env = envfile.parseEnv(
    ['# comment', 'A="1"', "B='two'", 'C=three  # 説明', 'D="MY_GEMINI_API_KEY"', 'E="ここにキー"', '# F="x"', 'G=""', 'H="a\\"b"'].join('\n')
  );
  assert.deepEqual(env, { A: '1', B: 'two', C: 'three', D: '', E: '', G: '', H: 'a"b' });
});

test('.env: 書き換え（既存行・コメントアウト行・追加）でコメントを壊さない', () => {
  let t = ['# 基本', 'GEMINI_API_KEY=""', 'META_VERIFY_TOKEN=""     # 任意の文字列', '# GEMINI_MODEL=""', ''].join('\n');
  t = envfile.setEnv(t, 'GEMINI_API_KEY', 'AIza123');
  t = envfile.setEnv(t, 'META_VERIFY_TOKEN', 'vt');
  t = envfile.setEnv(t, 'GEMINI_MODEL', 'gemini-9-flash');
  t = envfile.setEnv(t, 'NEW_KEY', 'v"q');
  assert.equal(
    t,
    ['# 基本', 'GEMINI_API_KEY="AIza123"', 'META_VERIFY_TOKEN="vt"  # 任意の文字列', 'GEMINI_MODEL="gemini-9-flash"', 'NEW_KEY="v\\"q"', ''].join('\n')
  );
  assert.equal(envfile.parseEnv(t).NEW_KEY, 'v"q');
});

test('.env: 実際の .env.example を読み書きできる', () => {
  const example = fs.readFileSync(path.join(import.meta.dirname, '..', '.env.example'), 'utf8');
  const t = envfile.setEnv(envfile.setEnv(example, 'GEMINI_API_KEY', 'k1'), 'LINE_CHANNEL_SECRET', 's1');
  const env = envfile.parseEnv(t);
  assert.equal(env.GEMINI_API_KEY, 'k1');
  assert.equal(env.LINE_CHANNEL_SECRET, 's1');
  assert.equal(env.ADMIN_TOKEN, '');
  assert.equal(t.split('\n').length, example.split('\n').length, '行が増えない（既存の行を書き換える）');
});

// ============================================================ キーの確認

const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('Gemini: モデルのおすすめ選択', () => {
  const r = checks.pickModels(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image', 'embedding-001']);
  assert.equal(r.text, 'gemini-3.8-flash');
  assert.equal(r.image, 'gemini-3.1-flash-lite-image');
});

test('Gemini: キーが有効でモデルがあればOK、なければ代わりを提案', async () => {
  const models = (names: string[]) => async () =>
    jsonRes(200, { models: names.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) });
  const ok = await checks.checkGeminiKey('k', { fetchImpl: models(['gemini-3.8-flash', 'gemini-3.1-flash-lite-image']) });
  assert.deepEqual([ok.ok, ok.textModelOk, ok.imageModelOk], [true, true, true]);

  const alt = await checks.checkGeminiKey('k', { fetchImpl: models(['gemini-3.5-flash', 'gemini-3.5-flash-image']) });
  assert.equal(alt.textModelOk, false);
  assert.equal(alt.suggest.text, 'gemini-3.5-flash');
  assert.equal(alt.suggest.image, 'gemini-3.5-flash-image');
});

test('Gemini: 無効なキー・通信エラーを区別して伝える', async () => {
  const bad = await checks.checkGeminiKey('k', { fetchImpl: async () => jsonRes(400, { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }) });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /正しくない/);
  const net = await checks.checkGeminiKey('k', { fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(net.ok, false);
  assert.equal(net.network, true);
});

test('LINE: トークン確認とシークレットの形式チェック', async () => {
  const ok = await checks.checkLineToken('t', { fetchImpl: async () => jsonRes(200, { displayName: '山田AI広報', basicId: '@123abc' }) });
  assert.deepEqual([ok.ok, ok.displayName], [true, '山田AI広報']);
  const bad = await checks.checkLineToken('t', { fetchImpl: async () => jsonRes(401, { message: 'Authentication failed' }) });
  assert.equal(bad.ok, false);
  assert.equal(checks.looksLikeLineSecret('0123456789abcdef0123456789abcdef'), true);
  assert.equal(checks.looksLikeLineSecret('eyJhbGciOi...long-token'), false);
});

// ============================================================ デプロイ

const ENV = {
  GEMINI_API_KEY: 'AIzaKEY',
  ADMIN_TOKEN: 'a'.repeat(64),
  LINE_CHANNEL_SECRET: 's'.repeat(32),
  LINE_CHANNEL_ACCESS_TOKEN: 'tok',
  PORT: '3000',
  DATA_DIR: 'data',
  GEMINI_MODEL: '',
};

/** gcloud の偽物。呼ばれたコマンドを記録し、状況に応じた結果を返す */
function fakeGcloud(o: { serviceJson?: any; bucketExists?: boolean; noGcloud?: boolean; noProject?: boolean; enableFails?: boolean } = {}) {
  const calls: string[][] = [];
  let envFile = '';
  const run = (args: string[]) => {
    calls.push(args);
    const j = args.join(' ');
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (j === '--version') return o.noGcloud ? { code: 127, stdout: '', stderr: 'not found' } : ok('Google Cloud SDK');
    if (j === 'config get-value account') return ok('me@example.com\n');
    if (j === 'config get-value project') return ok(o.noProject ? '(unset)\n' : 'my-proj\n');
    if (j.startsWith('services enable')) return o.enableFails ? { code: 1, stdout: '', stderr: 'billing' } : ok();
    if (j.startsWith('storage buckets describe')) return o.bucketExists ? ok('my-proj-leadgen-data') : { code: 1, stdout: '', stderr: 'not found' };
    if (j.startsWith('projects describe')) return ok('123456\n');
    if (j.includes('services describe') && j.includes('--format=json')) {
      return o.serviceJson ? ok(JSON.stringify(o.serviceJson)) : { code: 1, stdout: '', stderr: 'not found' };
    }
    if (j.includes('services describe') && j.includes('status.url')) return ok('https://leadgen-agent-xyz.a.run.app\n');
    if (args[0] === 'run' && args[1] === 'deploy') {
      envFile = fs.readFileSync(args[args.indexOf('--env-vars-file') + 1], 'utf8');
      return ok();
    }
    return ok();
  };
  return { run, calls, envFile: () => envFile };
}

const fakeFetch = (lineActive: boolean | null = false) => {
  const urls: string[] = [];
  const f = async (url: string, init?: any) => {
    urls.push(url);
    if (url.endsWith('/health')) return jsonRes(200, { ok: true });
    if (url.endsWith('/api/admin/line/setup-webhook')) {
      assert.equal(init.headers.Authorization, `Bearer ${ENV.ADMIN_TOKEN}`);
      return jsonRes(200, { result: { ok: true, active: lineActive, message: 'done' } });
    }
    return jsonRes(404, {});
  };
  return { f, urls };
};

test('デプロイ（初回）: API有効化→バケット作成→権限→公開→APP_URL設定→動作確認→LINE自動設定', async () => {
  const g = fakeGcloud();
  const ff = fakeFetch(false);
  const r = await deployer.deploy({ run: g.run, env: ENV, root: '/repo', fetchImpl: ff.f, log: () => {}, sleep: async () => {} });

  const joined = g.calls.map((c) => c.join(' '));
  assert.ok(joined.some((c) => c.startsWith('services enable run.googleapis.com cloudbuild.googleapis.com')));
  assert.ok(joined.some((c) => c === 'storage buckets create gs://my-proj-leadgen-data --location asia-northeast1 --uniform-bucket-level-access --project my-proj'));
  assert.ok(joined.some((c) => c.includes('--member=serviceAccount:123456-compute@developer.gserviceaccount.com')));
  const dep = g.calls.find((c) => c[0] === 'run' && c[1] === 'deploy')!;
  for (const flag of ['--max-instances', '--no-cpu-throttling', '--allow-unauthenticated', '--add-volume', '--add-volume-mount', '--quiet']) {
    assert.ok(dep.includes(flag), flag);
  }
  assert.ok(dep.includes('name=data,type=cloud-storage,bucket=my-proj-leadgen-data'));
  assert.ok(joined.some((c) => c.includes('services update') && c.includes('APP_URL=https://leadgen-agent-xyz.a.run.app')));

  // 環境変数ファイル: 空・除外キーは渡さない／キーは渡す
  const y = g.envFile();
  assert.match(y, /GEMINI_API_KEY: "AIzaKEY"/);
  assert.match(y, /LINE_CHANNEL_ACCESS_TOKEN: "tok"/);
  assert.doesNotMatch(y, /PORT|DATA_DIR|GEMINI_MODEL/);

  assert.equal(r.url, 'https://leadgen-agent-xyz.a.run.app');
  assert.deepEqual(r.line, { ok: true, active: false, message: 'done' });
  assert.ok(ff.urls.includes('https://leadgen-agent-xyz.a.run.app/health'));
});

test('デプロイ（2回目）: 既存のボリュームは追加せず、APP_URL は環境変数ファイルに含める', async () => {
  const g = fakeGcloud({
    bucketExists: true,
    serviceJson: { status: { url: 'https://leadgen-agent-xyz.a.run.app' }, spec: { template: { spec: { volumes: [{ name: 'data' }] } } } },
  });
  await deployer.deploy({ run: g.run, env: ENV, root: '/repo', fetchImpl: fakeFetch(true).f, log: () => {}, sleep: async () => {} });
  const joined = g.calls.map((c) => c.join(' '));
  assert.ok(!joined.some((c) => c.startsWith('storage buckets create')));
  const dep = g.calls.find((c) => c[0] === 'run' && c[1] === 'deploy')!;
  assert.ok(!dep.includes('--add-volume'));
  assert.ok(!joined.some((c) => c.includes('services update')));
  assert.match(g.envFile(), /APP_URL: "https:\/\/leadgen-agent-xyz.a.run.app"/);
});

test('デプロイ: 準備不足はわかりやすいメッセージで止まる（gcloud 未導入・プロジェクト未選択・課金なし・setup 未実行）', async () => {
  const run = (o: any, env = ENV) => deployer.deploy({ run: fakeGcloud(o).run, env, root: '/repo', fetchImpl: fakeFetch().f, log: () => {}, sleep: async () => {} });
  await assert.rejects(run({ noGcloud: true }), /gcloud（Google Cloud CLI）が見つかりません/);
  await assert.rejects(run({ noProject: true }), /gcloud config set project/);
  await assert.rejects(run({ enableFails: true }), /請求先アカウント/);
  await assert.rejects(run({}, { ...ENV, GEMINI_API_KEY: '' }), /npm run setup/);
});

test('デプロイ: キー入りの一時ファイルは必ず削除される', async () => {
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('leadgen-')));
  const g = fakeGcloud();
  await deployer.deploy({ run: g.run, env: ENV, root: '/repo', fetchImpl: fakeFetch().f, log: () => {}, sleep: async () => {} });
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('leadgen-') && !before.has(n));
  assert.deepEqual(after, []);
});

test('Windows 用の引数クォート', () => {
  assert.equal(deployer.quoteWin('--format=value(name)'), '"--format=value(name)"');
  assert.equal(deployer.quoteWin('C:\\Users\\Taro Yamada\\env.yaml'), '"C:\\Users\\Taro Yamada\\env.yaml"');
  assert.equal(deployer.quoteWin('--quiet'), '--quiet');
});
