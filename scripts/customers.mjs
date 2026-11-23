#!/usr/bin/env node
/**
 * 登録済みのお客様の一覧を表示する（npm run customers）。
 * 公開URL・公開先プロジェクト・最終更新日が一目で分かる。鍵は表示しない。
 *
 * @example
 *   npm run customers
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCustomers } from './lib/customers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = listCustomers(root);

if (!list.length) {
  console.log('\n登録済みのお客様はいません。');
  console.log('追加するには:  npm run setup 会社名   （例: npm run setup acme）\n');
} else {
  console.log(`\n登録済みのお客様（${list.length}社）\n`);
  for (const { name, meta } of list) {
    const when = meta.deployedAt ? new Date(meta.deployedAt).toLocaleString('ja-JP') : '';
    console.log(`  ■ ${name}`);
    console.log(`     URL        : ${meta.url || '（まだ公開していません → npm run deploy ' + name + '）'}`);
    console.log(`     プロジェクト: ${meta.project || 'gcloud で選択中のもの'}`);
    if (when) console.log(`     最終公開   : ${when}`);
  }
  console.log('\n全社を更新するには:  npm run deploy all\n');
}
