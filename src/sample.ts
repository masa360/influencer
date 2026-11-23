/**
 * ボス（あなた）情報の初期サンプルと、「サンプルのまま」かどうかの判定。
 *
 * サンプルの実績（例: 支援実績〇〇社）が残ったまま公開すると、AIが架空の実績を語ってしまう
 * （景品表示法の優良誤認のおそれ）ため、画面で警告を出すのに使う。
 */

/** 初期表示のサンプル（【例】や〇〇の部分を、あなたの本当の情報に書き換える） */
export const DEFAULT_BOSS: Record<string, string> = {
  bossName: '【例】山田 太郎（代表）',
  bossTitle: '【例】AI×経営改革ストラテジスト',
  bossStrength: '【例】現場に定着するAI導入と、机上の空論ではない利益改善が得意。支援実績〇〇社。※あなたの本当の強み・実績に書き換えてください',
  targetAudience: '【例】年商1億〜30億円規模の中小企業経営者・役員',
  ctaGoal: '【例】60分の無料個別相談（壁打ち）への申込',
  ctaLinkText: '【例】プロフィールの公式LINEから「相談」と送信してください',
};

/** 以前の版の初期値（ブラウザに保存されている可能性があるもの） */
const LEGACY_SAMPLES = [
  'あなた（代表・エグゼクティブコンサルタント）',
  '現場に定着するAI導入と、机上の空論ではない泥臭い利益改善。支援実績100社以上。',
  '毎月5社限定の「AI経営・収益倍増60分無料壁打ち（個別相談）」への申込',
];

/** ボス情報の項目名（画面表示用） */
export const BOSS_FIELD_LABEL: Record<string, string> = {
  bossName: 'お名前',
  bossTitle: '肩書き',
  bossStrength: '強み・実績',
  targetAudience: 'ターゲット',
  ctaGoal: '誘導先（ゴール）',
  ctaLinkText: '誘導アクション',
};

/**
 * サンプルのまま残っている項目を返す（すべて書き換え済みなら空配列）。
 *
 * @example
 * sampleFields(DEFAULT_BOSS); // ['bossName', 'bossTitle', ...]
 * sampleFields({ ...DEFAULT_BOSS, bossName: '佐藤 花子' }).includes('bossName'); // false
 */
export function sampleFields(boss: Record<string, string> | null | undefined): string[] {
  if (!boss) return Object.keys(DEFAULT_BOSS);
  return Object.keys(DEFAULT_BOSS).filter((k) => {
    const v = (boss[k] || '').trim();
    return !v || v.includes('【例】') || v.includes('〇〇') || LEGACY_SAMPLES.includes(v);
  });
}
