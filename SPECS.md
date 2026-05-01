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
- スケジュール: 利用日でschedule.json検索→当日のPJコード抽出
- 履歴: vendor_name部分一致でreceipts.json検索→PJ・経費項目の多数決
- 信頼度: 両方一致95% / スケジュール単独85% / 履歴のみ最大80%

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
- **経費項目マスタの登録** — 楽々精算の項目を管理画面「経費項目マスタ」から追加（599/601/3267/3271/5331/6009）
- **部署マスタの登録** — 必要なら同様に
- **`BUDGET_FOLDER_SAITO`** — 予算書xlsm格納フォルダID。設定済み（`1R0DImYmFMdEYCGakvM8HSP-l2giGQA3-`）

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
