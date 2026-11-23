import type { Express, NextFunction, Request, Response } from 'express';
import * as h from './handlers.ts';
import { envValue } from './util.ts';

function baseUrlOf(req: Request): string {
  if (envValue('APP_URL')) return envValue('APP_URL');
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function adapt(handler: h.Handler) {
  return async (req: Request, res: Response) => {
    try {
      const out = await handler({
        method: req.method,
        headers: req.headers as Record<string, string | undefined>,
        query: req.query as Record<string, unknown>,
        body: req.body,
        rawBody: (req as any).rawBody ?? '',
        ip: req.ip || req.socket.remoteAddress || '',
        remote: req.socket.remoteAddress || '',
        params: req.params as Record<string, string>,
        baseUrl: baseUrlOf(req),
      });
      for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
      res.status(out.status);
      if (out.text !== undefined) res.type(out.contentType || 'text/plain').send(out.text);
      else if (out.body === undefined) res.end();
      else res.json(out.body);
    } catch (e) {
      console.error('[route] unhandled error:', e);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  };
}

/**
 * 管理者だけが使えるAPI用のミドルウェア（ADMIN_TOKEN で保護）。
 * Gemini の利用料が発生する生成API（/api/generate-*, /api/chat-dm）にも使う。
 *
 * @example
 * app.post('/api/generate-content', requireAdmin, handler);
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const denied = h.adminGuard({
    headers: req.headers as Record<string, string | undefined>,
    remote: req.socket.remoteAddress || '',
  } as h.Req);
  if (denied) {
    res.status(denied.status).json(denied.body);
    return;
  }
  next();
}

export function registerRoutes(app: Express) {
  // --- プラットフォームWebhook ---
  app.get('/webhooks/meta', adapt(h.metaWebhookGet));
  app.post('/webhooks/meta', adapt(h.metaWebhookPost));
  app.post('/webhooks/line', adapt(h.lineWebhookPost));

  // --- LP/HP（ウィジェット・フォーム） ---
  app.get('/widget.js', adapt(h.widgetJs));
  app.options('/api/inbound/web', adapt(h.webInbound));
  app.post('/api/inbound/web', adapt(h.webInbound));

  // --- サーバー間API ---
  app.post('/api/v1/reply', adapt(h.apiReply));

  // --- 管理API ---
  app.get('/api/admin/state', adapt(h.adminGetState));
  app.put('/api/admin/config', adapt(h.adminPutConfig));
  app.get('/api/admin/inbox', adapt(h.adminInbox));
  app.post('/api/admin/inbox/:id/approve', adapt(h.adminApprove));
  app.post('/api/admin/inbox/:id/reject', adapt(h.adminReject));
  app.post('/api/admin/test-reply', adapt(h.adminTestReply));
  app.post('/api/admin/keys/rotate', adapt(h.adminRotateKey));
  app.post('/api/admin/youtube/poll', adapt(h.adminYoutubePoll));
  app.post('/api/admin/test-notify', adapt(h.adminTestNotify));
  app.post('/api/admin/line/register-code', adapt(h.adminLineRegisterCode));
  app.post('/api/admin/line/setup-webhook', adapt(h.adminLineSetupWebhook));
  app.get('/api/admin/gas-code', adapt(h.adminGasCode));
}
