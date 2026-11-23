import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leadgen-routes-'));
process.env.ADMIN_TOKEN = 'tok';
process.env.META_VERIFY_TOKEN = 'vt';
delete process.env.APP_URL;

const { registerRoutes, requireAdmin } = await import('../server/routes.ts');
const store = await import('../server/store.ts');

// Express を使わずに「ルート登録 → アダプタ変換」だけ検証する簡易モック
const routes = new Map<string, (req: any, res: any) => Promise<void>>();
const app: any = {};
for (const m of ['get', 'post', 'put', 'options']) app[m] = (p: string, h: any) => routes.set(`${m.toUpperCase()} ${p}`, h);
registerRoutes(app);

function call(key: string, req: Partial<any> = {}) {
  const out: any = { headers: {}, status: 200, body: undefined, ended: false, type: undefined };
  const res: any = {
    setHeader: (k: string, v: string) => (out.headers[k] = v),
    status(n: number) { out.status = n; return res; },
    type(t: string) { out.type = t; return res; },
    send(b: any) { out.body = b; },
    json(b: any) { out.body = b; },
    end() { out.ended = true; },
  };
  const full = { method: key.split(' ')[0], headers: {}, query: {}, body: {}, params: {}, protocol: 'https', socket: { remoteAddress: '127.0.0.1' }, ip: '9.9.9.9', ...req };
  return routes.get(key)!(full, res).then(() => out);
}

test('全ルートが登録されている', () => {
  for (const k of [
    'GET /webhooks/meta', 'POST /webhooks/meta', 'POST /webhooks/line',
    'GET /widget.js', 'OPTIONS /api/inbound/web', 'POST /api/inbound/web', 'POST /api/v1/reply',
    'GET /api/admin/state', 'PUT /api/admin/config', 'GET /api/admin/inbox',
    'POST /api/admin/inbox/:id/approve', 'POST /api/admin/inbox/:id/reject',
    'POST /api/admin/test-reply', 'POST /api/admin/keys/rotate', 'POST /api/admin/youtube/poll',
  ]) assert.ok(routes.has(k), k);
});

test('Metaの検証チャレンジはプレーンテキストで返る', async () => {
  const r = await call('GET /webhooks/meta', { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '4242' } });
  assert.equal(r.status, 200);
  assert.equal(r.body, '4242');
  assert.match(r.type, /text\/plain/);
});

test('widget.js はJavaScriptとして返る', async () => {
  const r = await call('GET /widget.js');
  assert.match(r.type, /javascript/);
  assert.ok(r.body.includes('lead_widget_sid'));
});

test('管理APIはトークンなしで401、ありで200（Webhook URLはAPP_URL/ホストから生成）', async () => {
  assert.equal((await call('GET /api/admin/state', { socket: { remoteAddress: '8.8.8.8' } })).status, 401);
  const r = await call('GET /api/admin/state', { headers: { authorization: 'Bearer tok', host: 'app.example.com', 'x-forwarded-proto': 'https' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.urls.line, 'https://app.example.com/webhooks/line');
});

test('許可されていないオリジンのプリフライトは403、許可で204+CORSヘッダ', async () => {
  assert.equal((await call('OPTIONS /api/inbound/web', { headers: { origin: 'https://x.example' } })).status, 403);
  store.updateConfig({ web: { allowedOrigins: ['https://lp.example.com'] } });
  const r = await call('OPTIONS /api/inbound/web', { headers: { origin: 'https://lp.example.com' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://lp.example.com');
  assert.ok(r.ended);
});

test('Xのwebhookは登録されていない', () => {
  assert.ok(!routes.has('POST /webhooks/x'));
  assert.ok(!routes.has('GET /webhooks/x'));
});

test('requireAdmin: 生成API用のガードはトークンなしで401、正しいトークンで通過', () => {
  const run = (headers: Record<string, string>) => {
    const out: any = { status: 0, nexted: false };
    const res: any = { status(n: number) { out.status = n; return res; }, json(b: any) { out.body = b; } };
    requireAdmin({ headers, socket: { remoteAddress: '8.8.8.8' } } as any, res, () => (out.nexted = true));
    return out;
  };
  assert.equal(run({}).status, 401);
  assert.equal(run({ authorization: 'Bearer wrong' }).status, 401);
  assert.equal(run({ authorization: 'Bearer tok' }).nexted, true);
});
