/**
 * 導入代行（お客様ごとに1サーバー）のための、お客様フォルダの管理。
 *
 *   customers/<会社名>.env   … そのお客様の鍵・合言葉（秘密。GitHub・サーバーには上げない）
 *   customers/<会社名>.json  … 公開URLやプロジェクトIDなどのメモ（秘密ではないが、同じく上げない）
 *
 * 会社名を指定しない場合は、従来どおり .env と1台構成で動く（自分用）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 会社名に使えない名前（コマンドの特別な意味と重なるもの） */
export const RESERVED_NAMES = ['all', 'default', 'new', 'list', 'customers'];

/** 会社名の最大文字数（バケット名の上限 63 文字に収めるため） */
export const MAX_NAME_LENGTH = 20;

export class CustomerError extends Error {}

/**
 * 会社名（お客様の識別名）として使えるかを確認する。
 * 小文字の英数字とハイフンだけ。最初は英数字。最大20文字。
 *
 * @param {string} name 会社名（例: acme, tanaka-office）
 * @returns {string} 問題なければ同じ名前
 * @throws {CustomerError} 使えない名前のとき（理由つき）
 * @example
 * validateName('acme'); // 'acme'
 * validateName('Acme 株式会社'); // CustomerError
 */
export function validateName(name) {
  const n = String(name ?? '');
  if (RESERVED_NAMES.includes(n)) throw new CustomerError(`「${n}」は特別な意味があるため、会社名に使えません。別の名前にしてください。`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) {
    throw new CustomerError(`会社名「${n}」は使えません。小文字の英数字とハイフン（-）だけで、英数字から始めてください（例: acme, tanaka-office）。`);
  }
  if (n.length > MAX_NAME_LENGTH) throw new CustomerError(`会社名は${MAX_NAME_LENGTH}文字以内にしてください（現在${n.length}文字）。`);
  return n;
}

/**
 * お客様用ファイルの場所。
 * @param {string} root リポジトリのルート
 * @param {string} name 会社名
 * @returns {{ dir: string, env: string, meta: string }}
 */
export function customerPaths(root, name) {
  const dir = path.join(root, 'customers');
  return { dir, env: path.join(dir, `${name}.env`), meta: path.join(dir, `${name}.json`) };
}

/**
 * お客様のメモ（公開URLなど）を読む。なければ空のオブジェクト。
 * @returns {Record<string, any>}
 */
export function readMeta(root, name) {
  try {
    const m = JSON.parse(fs.readFileSync(customerPaths(root, name).meta, 'utf8'));
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

/**
 * お客様のメモを保存する（既存の内容に上書きでマージする）。
 * @param {string} root
 * @param {string} name
 * @param {Record<string, any>} patch 追加・更新する項目
 * @returns {Record<string, any>} 保存後の全項目
 */
export function writeMeta(root, name, patch) {
  const p = customerPaths(root, name);
  fs.mkdirSync(p.dir, { recursive: true });
  const next = { ...readMeta(root, name), ...patch, name };
  fs.writeFileSync(p.meta, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next;
}

/**
 * 登録済みのお客様（customers/*.env があるもの）を、名前順に返す。
 * @returns {{ name: string, meta: Record<string, any> }[]}
 */
export function listCustomers(root) {
  const { dir } = customerPaths(root, 'x');
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith('.env'))
    .map((f) => f.slice(0, -'.env'.length))
    .filter((n) => {
      try {
        validateName(n);
        return true;
      } catch {
        return false; // 手で置いた変な名前のファイルは無視
      }
    })
    .sort()
    .map((name) => ({ name, meta: readMeta(root, name) }));
}

/**
 * コマンドの引数から、対象（自分用 / 会社名 / 全社）を決める。
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {{ kind: 'default' } | { kind: 'customer', name: string } | { kind: 'all' }}
 * @throws {CustomerError} 会社名として使えない引数のとき
 * @example
 * parseTarget([]);          // { kind: 'default' }
 * parseTarget(['acme']);    // { kind: 'customer', name: 'acme' }
 * parseTarget(['all']);     // { kind: 'all' }
 */
export function parseTarget(argv) {
  const args = argv.filter((a) => !a.startsWith('-'));
  if (!args.length) return { kind: 'default' };
  if (args.length > 1) throw new CustomerError(`会社名は1つだけ指定してください（指定された引数: ${args.join(' ')}）`);
  if (args[0] === 'all') return { kind: 'all' };
  return { kind: 'customer', name: validateName(args[0]) };
}
