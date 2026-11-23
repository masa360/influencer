import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './store.ts';
import { envValue } from './util.ts';

/**
 * 起動時に表示する「設定チェックリスト」。
 * 初心者がつまずきやすい設定の抜け・誤りを、ターミナル（Cloud Run ならログ）に一覧表示する。
 *
 * @returns 表示用の行（✅ OK / ⚠️ 注意 / ❌ 要対応）
 *
 * @example
 * for (const line of setupChecklist()) console.log(line);
 * // [setup] ✅ GEMINI_API_KEY: 設定済み
 * // [setup] ❌ ADMIN_TOKEN: 未設定 …
 */
export function setupChecklist(): string[] {
  const out: string[] = [];
  const add = (mark: '✅' | '⚠️' | '❌' | '・', text: string) => out.push(`[setup] ${mark} ${text}`);
  const prod = process.env.NODE_ENV === 'production';

  // Gemini
  if (envValue('GEMINI_API_KEY')) add('✅', 'GEMINI_API_KEY: 設定済み');
  else add('❌', 'GEMINI_API_KEY: 未設定（AIの返信・コンテンツ生成ができません）');

  // 管理トークン
  const admin = envValue('ADMIN_TOKEN');
  if (!admin) {
    add(
      prod ? '❌' : '⚠️',
      prod
        ? 'ADMIN_TOKEN: 未設定（本番では管理画面・生成APIが使えません）'
        : 'ADMIN_TOKEN: 未設定（このパソコンからのアクセスのみ許可。公開前に必ず設定）'
    );
  } else if (admin.length < 16) {
    add('⚠️', 'ADMIN_TOKEN: 短すぎます（32文字以上のランダムな文字列を推奨）');
  } else {
    add('✅', 'ADMIN_TOKEN: 設定済み');
  }

  // LINE
  const lineSecret = !!envValue('LINE_CHANNEL_SECRET');
  const lineToken = !!envValue('LINE_CHANNEL_ACCESS_TOKEN');
  if (lineSecret && lineToken) add('✅', 'LINE: 設定済み');
  else if (lineSecret || lineToken) add('⚠️', `LINE: ${lineSecret ? 'LINE_CHANNEL_ACCESS_TOKEN' : 'LINE_CHANNEL_SECRET'} が未設定です`);
  else add('・', 'LINE: 未設定（LINE連携を使うときに設定）');

  // 公開URL（LINE通知のリンクに使う）
  if (prod && !envValue('APP_URL')) add('・', 'APP_URL: 未設定（LINE通知に受信ログへのリンクが付きません）');

  // データ保存先（コンテナ内で動いているときだけ「消える場所」かを判定する）
  const dir = path.resolve(process.env.DATA_DIR || 'data');
  if (prod && inContainer() && isEphemeralDir(dir) === true) {
    add('⚠️', `データ保存先 ${dir} が永続ボリュームではありません（再起動・再デプロイで設定や受信ログが消えます。--add-volume を確認）`);
  } else {
    add('・', `データ保存先: ${dir}`);
  }

  // 自動返信の状態
  const cfg = getConfig();
  const active = Object.entries(cfg.channels)
    .filter(([, c]) => c.mode !== 'off')
    .map(([id, c]) => `${id}=${c.mode === 'auto' ? '全自動' : '下書き'}`);
  add('・', `自動返信: ${cfg.masterEnabled ? '稼働中' : '停止中'}${active.length ? `（${active.join(', ')}）` : ''}`);

  return out;
}

/** Cloud Run（K_SERVICE）または Docker コンテナ内で動いているか */
export function inContainer(): boolean {
  if (process.env.K_SERVICE) return true;
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * ディレクトリが「コンテナ内の使い捨て領域」にあるか（Linux のみ判定）。
 * そのディレクトリ自身またはその親（/ 以外）がマウントポイントなら永続ボリュームとみなす。
 *
 * @returns true: 使い捨て / false: マウントされている / null: 判定できない（Mac・Windows など）
 */
export function isEphemeralDir(dir: string, mountInfo?: string): boolean | null {
  let info = mountInfo;
  if (info === undefined) {
    try {
      info = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    } catch {
      return null;
    }
  }
  // mountinfo の5列目がマウントポイント
  const points = new Set(
    info
      .split('\n')
      .map((l) => l.split(' ')[4])
      .filter((p): p is string => !!p && p !== '/')
  );
  for (let d = dir; d && d !== path.dirname(d); d = path.dirname(d)) {
    if (points.has(d)) return false;
  }
  return true;
}
