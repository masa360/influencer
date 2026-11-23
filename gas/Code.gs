/**
 * 受信ログをGoogleスプレッドシートに記録する Google Apps Script（GAS）。
 *
 * 使い方（くわしくは docs/SETUP_GUIDE.md の「STEP 5」）:
 *   1. アプリの「自動返信」タブ →「GASコードをコピー」でこのコードをコピーする
 *      （合言葉 SECRET_KEY は入力済み。手で書き換える必要はありません）
 *   2. 記録用のスプレッドシートを作り、「拡張機能」→「Apps Script」に貼り付けて保存
 *   3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *        実行するユーザー: 自分 / アクセスできるユーザー: 全員
 *   4. 発行されたURL（…/exec）を、アプリの「記録用Webhook URL（GAS）」に貼る
 *      （合言葉 ?key= はアプリが自動で付けます）
 *
 * ※ このファイルを直接コピーした場合は、下の SECRET_KEY を書き換え、URL の末尾に ?key=同じ値 を付けてください。
 *
 * 同じ受信（id）が「受信時・承認時・却下時」に何度か届くため、id が一致する行は上書き更新します。
 */

/** 合言葉（アプリの「GASコードをコピー」なら自動で入ります） */
const SECRET_KEY = 'ここを長いランダムな文字列に書き換える';

/** 記録するシート名（無ければ自動で作る） */
const SHEET_NAME = '受信ログ';

/** 列の並び（1行目の見出し） */
const HEADERS = ['ID', '受信日時', '更新日時', 'チャンネル', '種別', '状態', 'スコア', '意図', '名前', 'メール', '送信者ID', 'メッセージ', 'AIの返信', 'メモ', '流入ページ'];

/** 状態の表示名 */
const STATUS_LABEL = {
  sent: '送信済み',
  drafted: '承認待ち',
  needs_human: '要人間対応',
  skipped: 'スキップ',
  error: 'エラー',
  rejected: '却下',
};

/**
 * アプリからのPOSTを受け取り、1件を追記または更新する。
 *
 * @param {GoogleAppsScript.Events.DoPost} e - アプリから届いたリクエスト
 * @returns {GoogleAppsScript.Content.TextOutput} { ok: true } または { ok: false, error }
 *
 * @example
 * // アプリが送るJSONの例
 * // { "id": "m_xxx", "createdAt": "2026-11-23T00:00:00Z", "status": "drafted",
 * //   "leadScore": 85, "sender": { "name": "山田" }, "message": "相談したい", ... }
 */
function doPost(e) {
  // 合言葉が初期値のままなら受け付けない（誰でも書き込めてしまうため）
  if (/^ここを/.test(SECRET_KEY)) {
    return json_({ ok: false, error: 'secret_not_set（アプリの「GASコードをコピー」で取得したコードを使ってください）' });
  }
  // 合言葉の確認（URLの ?key= ）
  if (!e || !e.parameter || e.parameter.key !== SECRET_KEY) {
    return json_({ ok: false, error: 'invalid_key' });
  }

  // 同時に複数届いても行が重ならないようにロックする
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    const row = [
      d.id,
      toDate_(d.createdAt),
      toDate_(d.updatedAt),
      d.channel || '',
      d.kind || '',
      STATUS_LABEL[d.status] || d.status || '',
      d.leadScore == null ? '' : d.leadScore,
      d.intent || '',
      (d.sender && d.sender.name) || '',
      (d.sender && d.sender.email) || '',
      (d.sender && d.sender.id) || '',
      d.message || '',
      d.reply || '',
      d.note || '',
      (d.source && d.source.page) || '',
    ];

    const rowIndex = findRowById_(sheet, d.id);
    if (rowIndex > 0) {
      // 通信の順番が前後しても、古い状態で上書きしない（C列＝更新日時で比較）
      const current = sheet.getRange(rowIndex, 3).getValue();
      const incoming = row[2];
      if (current instanceof Date && incoming instanceof Date && incoming.getTime() < current.getTime()) {
        return json_({ ok: true, skipped: 'older_update' });
      }
      sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]); // 既存行を更新
    } else {
      sheet.appendRow(row); // 新しい行を追加
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 記録用シートを取得する（無ければ見出し付きで作成）。
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * A列（ID）から一致する行番号を探す。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} id
 * @returns {number} 行番号（見つからなければ -1）
 */
function findRowById_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2 || !id) return -1;
  const found = sheet.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return found ? found.getRow() : -1;
}

/**
 * ISO形式の日時文字列を Date に変換する（変換できなければ空文字）。
 * @param {string} s
 * @returns {Date|string}
 */
function toDate_(s) {
  const t = s ? new Date(s) : null;
  return t && !isNaN(t.getTime()) ? t : '';
}

/**
 * JSONレスポンスを作る。
 * @param {Object} obj
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
