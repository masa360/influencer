import crypto from 'node:crypto';
import { addLineNotifyUser, getKv, setKv } from './store.ts';
import { safeEqual } from './util.ts';

/**
 * 「自分のLINEを通知先に登録」する仕組み。
 *
 * 1. 管理画面で6桁のコードを発行する（有効期限10分）
 * 2. 運営者が自分のLINEから公式アカウントへ「通知登録 123456」と送る
 * 3. Webhook でそのメッセージを受け取り、送り主のユーザーIDを通知先に追加する
 *
 * → LINE Developers の画面で自分のユーザーIDを探してコピーする作業が不要になる。
 * コードは管理画面（ADMIN_TOKEN で保護）にしか表示されず、5回間違えると無効になる。
 */

const KV_KEY = 'line_register_code';
const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

interface CodeRec {
  code: string;
  exp: number;
  attempts: number;
}

/** 登録メッセージの形式（全角数字・全角スペースも受け付ける） */
const PATTERN = /^\s*通知登録[\s　]*([0-9０-９]{6})\s*$/;

/** 全角数字を半角にする */
const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

function readRec(): CodeRec | null {
  try {
    const raw = getKv(KV_KEY);
    return raw ? (JSON.parse(raw) as CodeRec) : null;
  } catch {
    return null;
  }
}

function writeRec(rec: CodeRec | null) {
  setKv(KV_KEY, rec ? JSON.stringify(rec) : '');
}

/**
 * 登録コードを新しく発行する（前のコードは無効になる）。
 * @returns 画面に表示するコードと、送ってもらう文面
 * @example
 * const { message } = issueRegistrationCode(); // message === '通知登録 482913'
 */
export function issueRegistrationCode(now = Date.now()): { code: string; message: string; expiresAt: string } {
  const code = String(crypto.randomInt(100000, 1000000));
  writeRec({ code, exp: now + TTL_MS, attempts: 0 });
  return { code, message: `通知登録 ${code}`, expiresAt: new Date(now + TTL_MS).toISOString() };
}

/** 受信メッセージが「通知登録 ○○○○○○」の形式か */
export function isRegistrationMessage(text: string): boolean {
  return PATTERN.test(text);
}

export type RegistrationResult = 'registered' | 'invalid' | 'expired' | 'full';

/**
 * 登録メッセージを処理する。正しいコードなら送り主を通知先に追加する。
 *
 * @param text   受信したメッセージ本文
 * @param userId 送り主のLINEユーザーID
 * @returns registered: 登録完了 / invalid: コード違い / expired: 期限切れ・未発行 / full: 上限(5件)
 */
export function handleRegistration(text: string, userId: string, now = Date.now()): RegistrationResult {
  const m = PATTERN.exec(text);
  const rec = readRec();
  if (!m || !rec || !rec.code || rec.exp < now) return 'expired';

  if (!safeEqual(toHalf(m[1]), rec.code)) {
    const attempts = rec.attempts + 1;
    writeRec(attempts >= MAX_ATTEMPTS ? null : { ...rec, attempts });
    return 'invalid';
  }

  writeRec(null); // 1回使ったら無効
  try {
    addLineNotifyUser(userId);
    return 'registered';
  } catch {
    return 'full';
  }
}

/** 登録結果に応じてLINEで返す文面 */
export const REGISTRATION_REPLY: Record<RegistrationResult, string> = {
  registered: '✅ このLINEを通知先に登録しました。見込み客や要人間対応のお問い合わせが来たら、ここにお知らせします。',
  invalid: '⚠️ コードが違います。管理画面に表示されている6桁のコードを確認して、もう一度送ってください。',
  expired: '⚠️ コードの有効期限が切れているか、まだ発行されていません。管理画面で「コードを発行」を押してから送ってください。',
  full: '⚠️ 通知先はすでに5件登録されています。管理画面で不要な通知先を削除してから、もう一度お試しください。',
};
