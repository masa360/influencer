/**
 * キーやトークンが「本当に使えるか」を確認する（npm run setup で使う）。
 * テストしやすいように fetch を差し替えられる。
 */

/** アプリが標準で使うモデル（server.ts / server/agent.ts と同じ値） */
export const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

/** "gemini-3.8-flash" → [3, 8] のようにバージョンを取り出す（比較用） */
function versionOf(name) {
  const m = /gemini-(\d+)(?:\.(\d+))?/.exec(name);
  return m ? [Number(m[1]), Number(m[2] || 0)] : [0, 0];
}
const newerFirst = (a, b) => {
  const [a1, a2] = versionOf(a);
  const [b1, b2] = versionOf(b);
  return b1 - a1 || b2 - a2 || a.length - b.length;
};

/**
 * 利用できるモデル一覧から、文章用・画像用のおすすめを選ぶ。
 * @param {string[]} names generateContent に対応したモデル名（'models/' なし）
 * @returns {{ text: string | null, image: string | null }}
 * @example
 * pickModels(['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-lite']); // { text: 'gemini-3.8-flash', image: null }
 */
export function pickModels(names) {
  const text = names
    .filter((n) => /^gemini-[\d.]+-flash$/.test(n))
    .sort(newerFirst)[0] ||
    names.filter((n) => /^gemini-.*flash/.test(n) && !/image|tts|audio|live|embed|vision/.test(n)).sort(newerFirst)[0] ||
    null;
  const image = names.filter((n) => /^gemini-.*image/.test(n) && !/preview-0|exp/.test(n)).sort(newerFirst)[0] || null;
  return { text, image };
}

/**
 * Gemini の API キーを確認し、アプリが使うモデルが利用できるかも調べる。
 *
 * @param {string} key APIキー
 * @param {{ fetchImpl?: typeof fetch, textModel?: string, imageModel?: string }} [opt]
 * @returns {Promise<{ ok: boolean, reason?: string, textModelOk?: boolean, imageModelOk?: boolean, suggest?: { text: string | null, image: string | null } }>}
 * @example
 * const r = await checkGeminiKey('AIza...');
 * if (r.ok && !r.textModelOk) console.log('おすすめ:', r.suggest.text);
 */
export async function checkGeminiKey(key, opt = {}) {
  const fetchImpl = opt.fetchImpl || fetch;
  const textModel = opt.textModel || DEFAULT_TEXT_MODEL;
  const imageModel = opt.imageModel || DEFAULT_IMAGE_MODEL;
  const names = [];
  let pageToken = '';
  try {
    for (let i = 0; i < 5; i++) {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await fetchImpl(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = JSON.stringify(data);
        if (res.status === 400 || res.status === 401 || res.status === 403 || /API_KEY_INVALID/.test(msg)) {
          return { ok: false, reason: 'APIキーが正しくないか、無効になっています。Google AI Studio でコピーし直してください。' };
        }
        return { ok: false, reason: `確認できませんでした（HTTP ${res.status}）。時間をおいてもう一度お試しください。` };
      }
      for (const m of data.models || []) {
        if ((m.supportedGenerationMethods || []).includes('generateContent')) names.push(String(m.name).replace(/^models\//, ''));
      }
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
  } catch (e) {
    return { ok: false, reason: `インターネット経由で確認できませんでした（${e?.message || e}）。キーは保存してあるので、あとで npm run setup をもう一度実行してください。`, network: true };
  }
  return {
    ok: true,
    textModelOk: names.includes(textModel),
    imageModelOk: names.includes(imageModel),
    suggest: pickModels(names),
  };
}

/**
 * LINE のチャネルアクセストークンを確認し、公式アカウント名を取得する。
 * @param {string} token チャネルアクセストークン（長期）
 * @param {{ fetchImpl?: typeof fetch }} [opt]
 * @returns {Promise<{ ok: boolean, displayName?: string, basicId?: string, reason?: string }>}
 */
export async function checkLineToken(token, opt = {}) {
  const fetchImpl = opt.fetchImpl || fetch;
  try {
    const res = await fetchImpl('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, reason: 'チャネルアクセストークンが正しくありません。LINE Developers で「長期」のトークンをコピーし直してください。' };
    if (!res.ok) return { ok: false, reason: `確認できませんでした（HTTP ${res.status}）` };
    return { ok: true, displayName: data.displayName, basicId: data.basicId };
  } catch (e) {
    return { ok: false, reason: `インターネット経由で確認できませんでした（${e?.message || e}）`, network: true };
  }
}

/** LINE のチャネルシークレットの形式（32桁の16進数）か */
export function looksLikeLineSecret(v) {
  return /^[0-9a-f]{32}$/.test(String(v || '').trim());
}
