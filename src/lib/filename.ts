/**
 * saito向け電帳法準拠ファイル名生成
 * フォーマット: {申請年月}_{PJ番号}_{企業名}_{経費項目}_{取引先}_{利用日}.{ext}
 * 例: 2026-05_01260289_岡山マルイ_業務雑費_院庄タクシー_2026-04-16.jpg
 */
export interface FilenameInput {
  apply_month: string | null   // 'YYYY-MM'
  pj_no: string | null
  client_name: string | null   // 企業名（客先）
  expense_item: string | null
  vendor_name: string | null
  usage_date: string | null    // 'YYYY-MM-DD'
  extra_tax_labels?: string[]  // 例: ['入湯税', '宿泊税']
}

export function sanitize(s: string | null | undefined, maxLen = 30): string {
  if (!s) return '不明';
  return String(s).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').substring(0, maxLen);
}

export function buildSaitoFilename(input: FilenameInput, originalFilename: string): string {
  const ext = originalFilename.includes('.')
    ? originalFilename.substring(originalFilename.lastIndexOf('.'))
    : '';
  const apply = sanitize(input.apply_month, 7);
  const pj = sanitize(input.pj_no, 12);
  const client = sanitize(input.client_name, 16);
  const item = sanitize(input.expense_item, 12);
  const vendor = sanitize(input.vendor_name, 20);
  const usage = sanitize(input.usage_date, 10);
  const extras = (input.extra_tax_labels || [])
    .filter(Boolean)
    .map(l => sanitize(l, 8))
    .join('_');
  const tail = extras ? `_${extras}` : '';
  return `${apply}_${pj}_${client}_${item}_${vendor}_${usage}${tail}${ext}`;
}

export function getCurrentApplyMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
