/**
 * saito向け電帳法準拠ファイル名生成
 * フォーマット: {申請年月}_{PJ番号}_{経費項目}_{取引先}_{利用日}.{ext}
 * 例: 2026-05_01-250131_交通費_JR東日本_2026-04-25.pdf
 */
export interface FilenameInput {
  apply_month: string | null   // 'YYYY-MM'
  pj_no: string | null
  expense_item: string | null
  vendor_name: string | null
  usage_date: string | null    // 'YYYY-MM-DD'
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
  const item = sanitize(input.expense_item, 12);
  const vendor = sanitize(input.vendor_name, 20);
  const usage = sanitize(input.usage_date, 10);
  return `${apply}_${pj}_${item}_${vendor}_${usage}${ext}`;
}

export function getCurrentApplyMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
