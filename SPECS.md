# 齋藤PJ・経費管理 仕様・課題メモ

齋藤デザイン専用。`js-shiire`（マリパラ専用）から分離した独立アプリ。

## URL / リポジトリ
- 本番: https://js-pj-manager.vercel.app
- GitHub: https://github.com/saito-design/js-pj-manager
- ローカルdev: ポート3100想定

## 画面構成
- `/` 管理画面（PC）: 経費一覧・編集・経費項目マスタ・スケジュール確認・QR
- `/submit` 申請画面（スマホ）: 撮影→画像調整→送信のみ。PJ・経費項目はPCで確定

## オペレーションフロー
1. **スマホ**: QR読込 → `/submit` → 申請年月（▲▼）→ カメラ撮影 → 明るさ・コントラスト・回転調整 → 送信
2. **サーバ**: 元画像をDriveアップロード → Claude Sonnet 4.6 OCR（取引先・利用日・合計・税額・税率・登録番号）→ ファイル名rename → receipts.json追記（status=pending）
3. **送信完了画面**: OCR読み取り結果すべて表示（読み取れず項目はグレー）
4. **PC**: 管理画面の未確定行を「編集」→ 自動で予測API呼出（スケジュール+履歴）→ 黄色パネルで予測表示→「適用」ボタンでPJ・経費項目を反映 → 保存（確定）

## 予測ロジック（/api/expenses/predict）
- スケジュール: 利用日でschedule.json検索→当日のPJコード抽出（件名「移動・前日入り」は除外）
- 履歴: vendor_name部分一致でreceipts.json検索→PJ・経費項目の多数決
- 部署: ① 同pj_no履歴 → ② 同client_name履歴 → ③ vendor履歴 の優先順
- 経費項目: ① 同vendor履歴 → ② 税率10%→601 / 8%→5331 デフォルト
- 分類(category): ① 同vendor履歴の最頻 → ② vendorキーワードからguessCategory（タクシー/宿泊/新幹線等）
- 備考(notes): 履歴から取れるが**自動補完は行わない**（伝票ごとに固有のため）
- 信頼度: 両方一致95% / スケジュール単独85% / 履歴のみ最大80%

## ファイル形式（楽々精算PDF限定対応）
- **送信時**: 元形式（JPG/PNG/PDF）のままDriveに保存。ファイル名拡張子は元形式
- **pending中**: JPGのまま保持 → 編集モーダルでReactCropトリミング可能
- **status=confirmed に変更時**: サーバ側で画像→PDF変換、source_file/source_file_id更新、旧JPGはゴミ箱
- 画像→PDF変換: `src/lib/imageToPdf.ts`（pdf-lib、A4最大595×842pt にフィット）
- 既存4月分18件は手動で `scripts/convert_jpg_to_pdf.mjs --month 2026-04` で一括変換済

## ファイル名規則
`{申請年月}_{PJ番号}_{企業名}_{分類}_{店名}_{利用日}.{ext}`
例: `2026-04_01260289_岡山マルイ_タクシー代_院庄タクシー_2026-04-16.pdf`
- nullフィールドは「不明」と展開（要改善: SPECS.md ①）
- `extra_tax_labels` で `_入湯税`/`_宿泊税` 末尾に付与可
- フォーム値変更時に [id]/route.ts のPUTでDriveのファイルもrename

## API課金
- Sonnet 4.6 + プロンプトキャッシュ で 1件 ≈ 1.4円
- 月20件想定 ≈ 30〜50円／月

## ロードマップ（MVP=経費処理）

このアプリのMVPは**経費処理**。下記の追加機能は運用が回り出してから段階的に実装。
（出典: `C:/dev/.claude/handover/handover-20260501-saito-pj-mvp.md` L71-79）

### Phase 2 候補（運用後・優先度: 中）
1. **submit時の自動予測適用** — 取引先入力→PJ・経費項目を自動サジェスト（編集モーダル予測は実装済。submit時の事前提示は未）
2. **CSV出力** — 楽々精算入力用 / 月次集計
3. **予算書ビューア** — xlsmから予算読込・残額表示

### Phase 3 候補（優先度: 中〜低）
4. **発注書管理** — 外部講師の予算
5. **予実管理ダッシュボード** — PJ別予算消化率
6. **稼働費管理** — スケジュール×単価から自動計算
7. **出張手配チェック・Outlook連携** — 1ヶ月先予定の自動取込

### 検討中（運用次第）
- 楽々精算との何らかの連携（API有無は未調査）

## 残課題（番号は会話履歴のオペレーション確認時に挙げたもの）

### 優先度：中
- **① ファイル名の「不明_不明」表記** — pj_no/expense_item がnullのとき`不明_不明`が混ざる。null時はセクションスキップして`{apply}_{vendor}_{usage}.jpg`にする方が綺麗
- **③ スマホで自分の投稿履歴を確認できない** — 「送信しました」のみ。直近10件くらい一覧表示あると安心
- **④ OCR失敗（extracted=null）時の扱い** — 現在は送信成功扱いだが投稿者は気付けない。失敗時は警告表示推奨

### 優先度：低
- **⑥ 元画像保存（電帳法スキャナ保存対応）** — 現在は加工後JPEGで上書き。元画像も別フォルダに保存すべき
- **⑦ カメラ撮影時の元ファイル名 `upload_{timestamp}`** — 一時ID。renameに失敗すると残るので別命名規則検討
- **⑧ 二重送信防止** — submit中はdisableされているが、ネットワーク遅延時に連打リスクあり。submit成功までボタン消す等

### 運用準備
- **経費項目マスタ登録済**: 6件（599/601/3267/3271/5331/6009）
- **部署マスタの登録** — 必要なら同様に
- **`BUDGET_FOLDER_SAITO`** — 予算書xlsm格納フォルダID。設定済み（`1R0DImYmFMdEYCGakvM8HSP-l2giGQA3-`）

### 過去データ取込状況（2026-05-02時点）
- 過去69件をPDFパーサで取込済（`scripts/parse_rakuraku_pdfs.py`）
- multiOutput.pdf（楽々精算伝票）から61件のnotes追記＋9件新規追加（`scripts/import_rakuraku_notes.py`）
- 経費_齋藤フォルダのローカルPDF77件をDriveアップロード＋紐付け（`scripts/upload_missing_receipts.mjs`）
- 4月分JPG 18件をPDFに変換（`scripts/convert_jpg_to_pdf.mjs --month 2026-04`）
- **未実施**: 各レシートPDFをClaudeに直接読ませて vendor_name 等を補完（明日タスク）

## スケジュール連携
- 取込元: `C:\Users\yasuh\OneDrive - 株式会社日本コンサルタントグループ　\MyDocuments\000_スケジュール管理\★スケジュール管理.xlsm`
- 取込スクリプト: 同フォルダ `upload_schedule.py`（Excel閉じてから手動実行）
- マクロ `RunMonthEnd()`: 報告書生成のみ（SaveCopyAs→tmp→python）。アップロードは独立運用
- 上書き先: `SCHEDULE_FOLDER_ID` の `schedule.json`（375件 / 全レコード）
- フィルタロジック: 月は数値比較（`parseInt(月) === parseInt(filter月)`）でゼロパディング差異を吸収

## 環境変数（Vercel + .env.local）
- `ANTHROPIC_API_KEY` — Claude API（Yasuito's Individual Org推奨／Receipt Manager別案件と別計算）
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`
- `COMPANY_FOLDER_SAITO` — 経費データ保存先
- `UPLOADS_FOLDER_SAITO` — レシート画像アップロード先
- `SCHEDULE_FOLDER_ID` — schedule.json格納先
- `BUDGET_FOLDER_SAITO` — 予算書xlsm格納先
- `SESSION_PASSWORD` — iron-session

## 注意事項（会話履歴より）
- ❌ Drive上のexpense_items.jsonを直接編集しない → 管理画面UIから操作
- ❌ デバッグ目的の連続デプロイ禁止 → ローカルbuild確認 → 1回でまとめてpush
- ❌ ルート直下に `app/` を残さない（Create Next Appの初期ファイル）→ `src/app/` のみ
- ❌ tsconfig `@/*` は `./src/*` を指す
- ❌ **デプロイ前に必ず実APIで挙動確認**（推測でpushしない）。memory/feedback-accuracy-over-speed.md
- ❌ 予測の自動補完は「空欄のみ」原則。schedule予測でも既存値を上書きしない（ユーザー手入力・保存値を保護）

## 実装済の編集モーダル機能まとめ
- 画像サムネ常時表示・「✂ 余白を再トリミング」（react-image-crop、枠ドラッグ式、四隅黄色四角）
- 予測パネル: PJ・経費項目・スケジュール候補（クリックで個別適用、適用ボタンで先頭適用）
- 分類フィールド: ボタン式（CATEGORIES 15種から選択）
- 状態フィールド: ボタン式（未確定/確定）
- ファイル名ビフォーアフター表示（buildSaitoFilenameでプレビュー）
- 「保存して次」/「保存して閉じる」/ キャンセル
- 「保存して次」: 利用日順で次のpending → 無ければ前方探索 → 無ければ閉じる
- トリミング画面が開いたまま「保存」押下時、自動でクロップ→ファイル差し替え→フォーム保存
- ReactCrop枠スタイル: amber 3px / 角14px黄色四角（globals.css）

## 関連スクリプト
- `scripts/parse_rakuraku_pdfs.py` — 楽々精算PDFから初回データ取込
- `scripts/import_rakuraku_notes.py` — multiOutput.pdf から備考(notes)追加・未マッチ新規追加
- `scripts/upload_missing_receipts.mjs` — ローカル経費_齋藤フォルダ→Driveアップロード＋source_file_id紐付け
- `scripts/convert_jpg_to_pdf.mjs` — 既存JPGを一括PDF変換（`--month YYYY-MM`で月絞り）
- `scripts/dl_receipt.mjs` — Driveから単一ファイル取得（デバッグ用）
