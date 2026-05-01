// 用途分類（ファイル名・経費分類用）
export const CATEGORIES = [
  'タクシー代',
  '宿泊代',
  '新幹線代',
  '電車代',
  'バス代',
  'レンタカー代',
  '高速代',
  '駐車場代',
  '講師食事代',
  'コピー代',
  '宿泊調査費',
  '書籍代',
  '文具代',
  '通信費',
  'その他',
] as const

export type Category = typeof CATEGORIES[number]

// vendor_nameからカテゴリを推定（キーワードマッチ）
export function guessCategory(vendor: string | null): string | null {
  if (!vendor) return null
  const v = vendor.toLowerCase()
  // タクシー
  if (/タクシー|taxi|交通/.test(vendor)) return 'タクシー代'
  // 宿泊
  if (/ホテル|旅館|inn|hotel|ホステル|ペンション|民宿|リゾート/.test(vendor) || /hotel/.test(v)) return '宿泊代'
  // 新幹線・電車
  if (/jr|新幹線|きっぷ|乗車券|特急/.test(vendor) || /^jr/.test(v)) return '新幹線代'
  if (/電車|地下鉄|メトロ|私鉄|京急|京王|東急|東武|西武|京成|小田急|相鉄/.test(vendor)) return '電車代'
  if (/バス|高速バス|空港リムジン/.test(vendor)) return 'バス代'
  // レンタカー
  if (/レンタカー|rent.?a.?car|ニコニコレンタカー|タイムズカー|オリックスレンタ/.test(vendor)) return 'レンタカー代'
  // 高速
  if (/etc|高速|nexco|阪神高速|首都高/.test(vendor) || /etc/.test(v)) return '高速代'
  // 駐車場
  if (/パーキング|駐車場|タイムズ|coin parking/.test(vendor)) return '駐車場代'
  // 食事
  if (/レストラン|食堂|料亭|寿司|焼肉|居酒屋|ダイニング|喫茶|カフェ|cafe|coffee|ルノアール|スターバックス|ドトール|ガスト|サイゼリヤ|マクドナルド|モスバーガー/.test(vendor)) return '講師食事代'
  // コピー・書類
  if (/コピー|キンコーズ|kinko|プリント/.test(vendor)) return 'コピー代'
  // 書籍
  if (/書店|ブックス|紀伊国屋|丸善|ジュンク堂|amazon|アマゾン/.test(vendor)) return '書籍代'
  // 文具
  if (/文具|ロフト|東急ハンズ|無印|MUJI/.test(vendor)) return '文具代'
  return null
}
