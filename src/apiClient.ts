/**
 * 画面からサーバーAPIを呼ぶための共通処理。
 *
 * 管理トークン（サーバーの ADMIN_TOKEN と同じ値）はブラウザのタブを閉じると消える
 * sessionStorage に保存します。「自動返信」タブと「コンテンツ生成」で共用します。
 */

export const TOKEN_KEY = 'leadgen_admin_token';

/** 保存済みの管理トークンを取得する（無ければ空文字） */
export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/** 管理トークンを保存する */
export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* プライベートモード等で保存できない場合は無視 */
  }
}

/**
 * 管理トークン付きで JSON API を POST する。
 * 401 が返ったら管理トークンの入力を求め、1回だけ再試行する。
 *
 * @param path   呼び出すAPIのパス
 * @param body   送信するJSONオブジェクト
 * @returns      レスポンスのJSON
 * @throws       通信失敗・HTTPエラー時（message にサーバーのエラー文言を入れる）
 *
 * @example
 * const pack = await postJson('/api/generate-content', { persona, bossProfile, themeInput });
 */
export async function postJson<T = any>(path: string, body: unknown): Promise<T> {
  const send = () =>
    fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getAdminToken() ? { Authorization: `Bearer ${getAdminToken()}` } : {}),
      },
      body: JSON.stringify(body),
    });

  let res = await send();
  if (res.status === 401) {
    const input = window.prompt('管理トークン（サーバーの ADMIN_TOKEN）を入力してください');
    if (input) {
      setAdminToken(input.trim());
      res = await send();
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error === 'unauthorized' ? '管理トークンが正しくありません' : data.message || data.error || `HTTP ${res.status}`);
  }
  return data as T;
}
