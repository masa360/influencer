/**
 * .env ファイルの読み書き（コメントや並び順を保ったまま、値だけ書き換える）。
 * npm run setup / npm run deploy の両方で使う。外部ライブラリは使わない。
 */

/** 仮の値（.env.example のサンプルや手順書の「ここに…」）を未設定として扱う */
export function isPlaceholder(v) {
  const s = String(v ?? '').trim();
  return !s || /^MY_[A-Z_]+$/.test(s) || /^ここに/.test(s);
}

/**
 * .env の文字列を { KEY: 値 } にする（コメント行・空行は無視。仮の値は空文字）。
 *
 * @param {string} text .env の中身
 * @returns {Record<string, string>}
 * @example
 * parseEnv('A="1"\n# B="2"\nC=3'); // { A: '1', C: '3' }
 */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    // 行末コメント（クォート外の # 以降）を取り除く
    if (/^"/.test(v)) v = (/^"((?:[^"\\]|\\.)*)"/.exec(v) || [, ''])[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    else if (/^'/.test(v)) v = (/^'([^']*)'/.exec(v) || [, ''])[1];
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = isPlaceholder(v) ? '' : v;
  }
  return out;
}

/** 値を .env 用にクォートする */
function quote(value) {
  const v = String(value).replace(/[\r\n]+/g, '').trim();
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * .env の文字列の中で KEY の値を書き換える。
 * - `KEY=...` があればその行を置き換える
 * - `# KEY=...`（コメントアウト）しかなければ、その行を有効にして置き換える
 * - どちらもなければ末尾に追加する
 *
 * @param {string} text  .env の中身
 * @param {string} key   書き換えるキー
 * @param {string} value 新しい値
 * @returns {string} 書き換え後の .env の中身
 * @example
 * setEnv('A=""\n', 'A', 'x'); // 'A="x"\n'
 */
export function setEnv(text, key, value) {
  const lines = String(text).split(/\r?\n/);
  const line = `${key}=${quote(value)}`;
  const active = new RegExp(`^\\s*${key}\\s*=`);
  const commented = new RegExp(`^\\s*#\\s*${key}\\s*=`);
  let i = lines.findIndex((l) => active.test(l));
  if (i < 0) i = lines.findIndex((l) => commented.test(l));
  if (i >= 0) {
    // 行末の「# 説明」コメントは残す
    const comment = (/\s(#\s.*)$/.exec(lines[i].replace(/"(?:[^"\\]|\\.)*"/g, '""')) || [])[1];
    lines[i] = comment ? `${line}  ${comment}` : line;
  } else {
    if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, line);
    else lines.push(line);
  }
  return lines.join('\n');
}
