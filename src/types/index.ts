// saito向け型定義（PJ管理アプリ用）

export interface Project {
  pj_no: string         // 例: '01-250131'
  client_name: string   // 客先名 例: '鹿児島県市町村職員共済組合'
  case_name: string     // 案件名 例: 'マリンパレス経営改善施策の取り組みご支援'
  display_name: string  // 表示用 = `${pj_no} ${case_name}`
  budget_file_id?: string
}

export interface ExpenseItem {
  code: string
  name: string
  category?: string  // 例: '直接費・原価'
}

export interface Department {
  code: string
  name: string
}

// 税区分: '10'=10%, '8'=軽減8%, 'free'=非課税, 'out'=不課税, null=未設定
export type TaxCategory = '10' | '8' | 'free' | 'out' | null

export interface ReceiptSaito {
  id: string
  pj_no: string | null
  pj_name: string | null            // PJ件名（スケジュール由来）
  client_name: string | null        // 客先名/企業名（スケジュール得意先名 由来）
  expense_item: string | null      // 経費項目名（楽々精算）
  expense_item_code: string | null // 経費項目コード（楽々精算）
  category: string | null          // 用途分類（タクシー代/宿泊代/新幹線代等。ファイル名にも使用）
  vendor_name: string | null       // 取引先名
  apply_month: string | null       // 'YYYY-MM'
  usage_date: string | null        // 'YYYY-MM-DD'
  invoice_no: string | null        // インボイス登録番号（T+13桁）
  total_amount: number | null
  tax_amount: number | null
  tax_rate: number | null          // 0.10 / 0.08 / 0 / null
  tax_category: TaxCategory        // '10' | '8' | 'free' | 'out' | null
  extra_tax_labels: string[]       // 例: ['入湯税', '宿泊税']。ファイル名末尾に付与
  department_code: string | null   // 5101 etc.
  source_file: string | null       // Drive上のファイル名
  source_file_id: string | null    // Drive file ID
  status: 'pending' | 'confirmed'
  raw_text: string | null
  created_at: string
  updated_at: string
}

export interface PredictionResult {
  pj_no: string | null
  expense_item_code: string | null
  vendor_name: string | null
  source: 'history' | 'none'
  confidence: number  // 0〜1
}
