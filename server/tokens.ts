import { getToken, setToken } from './store.ts';
import { httpJson } from './util.ts';

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** YouTube Data API 用 Google OAuth アクセストークン（refresh token から取得） */
export async function getGoogleAccessToken(): Promise<string> {
  const env = process.env;
  const cached = getToken('google');
  if (cached && cached.exp > Date.now() + 60_000) return cached.access;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.YOUTUBE_REFRESH_TOKEN) {
    throw new Error('YouTube の認証情報が未設定です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN）');
  }
  const r = await httpJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'refresh_token',
      refresh_token: env.YOUTUBE_REFRESH_TOKEN,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });
  setToken('google', { access: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
  return r.access_token;
}
