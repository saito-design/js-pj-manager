"""
楽々精算PDFを解析してreceipts.jsonに追記するスクリプト

使い方:
  python parse_rakuraku_pdfs.py [--dry-run] [--pdf-dir C:/temp]

出力:
  Drive の saitoデータフォルダ (1LdM1jlSQniJ4nfWiZ3vKsIlIM_8AHveP) の
  receipts.json に既存データとマージして保存する

依存:
  pip install pdfminer.six google-auth google-api-python-client
"""

import re
import json
import uuid
import sys
import os
import argparse
from datetime import datetime
from pathlib import Path

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextBox

# -------- 設定 --------
EXPENSE_FOLDER = Path(
    "C:/Users/yasuh/OneDrive - 株式会社日本コンサルタントグループ　"
    "/MyDocuments/000_スケジュール管理/経費_齋藤"
)
PDF_DIR_DEFAULT = Path("C:/temp")
SAITO_FOLDER_ID = "1LdM1jlSQniJ4nfWiZ3vKsIlIM_8AHveP"
RECEIPTS_FILENAME = "receipts.json"

# Googleサービスアカウント（環境変数から）
GOOGLE_SA_JSON_B64 = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", "")
GOOGLE_CLIENT_EMAIL = (
    os.environ.get("GOOGLE_CLIENT_EMAIL")
    or os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL", "")
)
GOOGLE_PRIVATE_KEY = os.environ.get("GOOGLE_PRIVATE_KEY", "")


# -------- Drive --------
def get_drive_service():
    import base64
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    if GOOGLE_SA_JSON_B64:
        creds_json = json.loads(base64.b64decode(GOOGLE_SA_JSON_B64))
    elif GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY:
        creds_json = {
            "type": "service_account",
            "client_email": GOOGLE_CLIENT_EMAIL,
            "private_key": GOOGLE_PRIVATE_KEY.replace("\\n", "\n"),
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    else:
        raise RuntimeError("Google認証情報が環境変数にありません")

    creds = service_account.Credentials.from_service_account_info(
        creds_json,
        scopes=["https://www.googleapis.com/auth/drive"],
    )
    return build("drive", "v3", credentials=creds)


def drive_get_file_id(service, folder_id, filename):
    q = (
        f"name='{filename}' and '{folder_id}' in parents "
        f"and trashed=false"
    )
    res = service.files().list(
        q=q,
        fields="files(id,name)",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
    ).execute()
    files = res.get("files", [])
    return files[0]["id"] if files else None


def drive_read_json(service, folder_id, filename):
    from googleapiclient.http import MediaIoBaseDownload
    import io

    file_id = drive_get_file_id(service, folder_id, filename)
    if not file_id:
        return []
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    buf.seek(0)
    return json.loads(buf.read().decode("utf-8"))


def drive_write_json(service, folder_id, filename, data):
    import io
    from googleapiclient.http import MediaIoBaseUpload

    content = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    media = MediaIoBaseUpload(io.BytesIO(content), mimetype="application/json")
    file_id = drive_get_file_id(service, folder_id, filename)
    if file_id:
        service.files().update(
            fileId=file_id,
            media_body=media,
            supportsAllDrives=True,
        ).execute()
        print(f"  Drive更新: {filename} ({len(data)}件)")
    else:
        meta = {"name": filename, "parents": [folder_id]}
        service.files().create(
            body=meta,
            media_body=media,
            supportsAllDrives=True,
        ).execute()
        print(f"  Drive新規作成: {filename} ({len(data)}件)")


# -------- PDF解析 --------
def extract_textboxes(pdf_path):
    items = []
    for page_num, page_layout in enumerate(extract_pages(str(pdf_path))):
        for element in page_layout:
            if isinstance(element, LTTextBox):
                text = element.get_text().replace("\n", " ").strip()
                if text:
                    items.append(
                        {
                            "page": page_num,
                            "x0": element.x0,
                            "y0": element.y0,
                            "text": text,
                        }
                    )
    return items


def parse_apply_month(code):
    """'20263' → '2026-03', '202512' → '2025-12'"""
    code = re.sub(r"[^0-9]", "", code)
    if len(code) == 5:
        return f"{code[:4]}-{code[4:].zfill(2)}"
    if len(code) == 6:
        return f"{code[:4]}-{code[4:]}"
    return None


def normalize_date_prefix(text):
    """ファイル名から YYYYMMDD 形式のプレフィックスを返す"""
    # YYYY-MM-DD (ハイフン区切り)
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return m.group(1) + m.group(2) + m.group(3)
    # YYYY_MMDD
    m = re.match(r"(\d{4})_(\d{4})", text)
    if m:
        return m.group(1) + m.group(2)
    # YYYYMMDD
    m = re.match(r"(\d{8})", text)
    if m:
        return m.group(1)
    # YYYY MM DD (スペース区切り)
    m = re.match(r"(\d{4})\s+(\d{2})\s+(\d{2})", text)
    if m:
        return m.group(1) + m.group(2) + m.group(3)
    # YYYY MMDD
    m = re.match(r"(\d{4})\s+(\d{4})", text)
    if m:
        return m.group(1) + m.group(2)
    # MMDD のみ（過去分）
    m = re.match(r"(\d{4})(?!\d)", text)
    if m and int(m.group(1)[:2]) <= 12:
        return m.group(1)  # MMDD のみ返す（年は呼び出し側で補完）
    return None


def find_actual_file(ref_filename, apply_month, date_counter):
    """
    ref_filename: PDFから抽出したファイル名（文字化けあり）
    apply_month: 'YYYY-MM'
    date_counter: {date_prefix: current_index} で同じ日付内の順序を追跡
    戻り値: (filename, vendor_name, expense_type)
    """
    prefix = normalize_date_prefix(ref_filename)
    if not prefix:
        return None, None, None

    search_dirs = [
        EXPENSE_FOLDER,
        EXPENSE_FOLDER / "過去分",
        EXPENSE_FOLDER / "交通費",
        EXPENSE_FOLDER / "請求用",
    ]

    candidates = []
    for d in search_dirs:
        if d.exists():
            for f in sorted(d.iterdir()):
                if f.suffix.lower() != ".pdf":
                    continue
                fname_prefix = normalize_date_prefix(f.name)
                if not fname_prefix:
                    continue
                # MMDD のみの場合、年を apply_month から補完して比較
                if len(fname_prefix) == 4:
                    year = apply_month[:4] if apply_month else ""
                    fname_prefix = year + fname_prefix
                if len(prefix) == 4:
                    year = apply_month[:4] if apply_month else ""
                    full_prefix = year + prefix
                else:
                    full_prefix = prefix
                if fname_prefix == full_prefix:
                    candidates.append(f)

    if not candidates:
        return None, None, None

    # 同じ日付内でのインデックスを追跡
    key = prefix
    idx = date_counter.get(key, 0)
    date_counter[key] = idx + 1

    chosen = candidates[idx] if idx < len(candidates) else candidates[-1]

    # ファイル名から取引先・経費種別を抽出
    # 形式: "DATECODE 取引先　経費種別.pdf"
    stem = chosen.stem
    name_part = re.sub(r"^[\d_\s]+", "", stem).strip()
    # 全角スペースで分割
    parts = name_part.split("　")
    vendor = parts[0].strip() if parts else None
    expense_type = parts[1].strip() if len(parts) > 1 else None

    return chosen.name, vendor, expense_type


def parse_pdf(pdf_path):
    """
    楽々精算PDFを解析してReceiptSaitoの配列を返す

    楽々精算PDFの座標構造（1明細 = 約44pt の帯）:
      y+0:  利用日(x≈56), 金額(x≈476), 数量(x≈577), 金額再掲(x≈683), 税率(x≈748)
      y-12: PJコード(x≈33), 部署コード(x≈423)
      y-16: 行番号(x≈21)
      y-28: インボイス番号(x≈707)
      y-32: 参照ファイル名(x≈33)
    """
    items = extract_textboxes(pdf_path)

    # ヘッダー抽出
    apply_no = None
    apply_month_code = None
    for it in items:
        if re.match(r"T\d{8}$", it["text"]):
            apply_no = it["text"]
        # 申請月コード: "20263" や "20262}" のように数字以外が混入する場合がある
        digits_only = re.sub(r"[^0-9]", "", it["text"])
        m = re.fullmatch(r"(202[0-9]\d{1,2})", digits_only)
        if m and it["x0"] < 200 and it["x0"] > 80:
            apply_month_code = m.group(1)

    apply_month = parse_apply_month(apply_month_code) if apply_month_code else None
    print(f"  申請No: {apply_no}, 申請月: {apply_month}")

    # 利用日行を特定（x≈56, "YYYY/MM/DD ()" パターン）
    date_items = [
        it
        for it in items
        if re.match(r"\d{4}/\d{2}/\d{2}", it["text"])
        and 40 < it["x0"] < 120
        and it["x0"] < 80  # ヘッダーの申請日(x≈99)を除外
    ]
    date_items.sort(key=lambda x: (x["page"], -x["y0"]))

    date_counter = {}
    records = []

    for date_item in date_items:
        page = date_item["page"]
        y_anchor = date_item["y0"]

        # 同じページの ±50pt 以内のアイテムを収集
        row_items = [
            it
            for it in items
            if it["page"] == page and -50 < it["y0"] - y_anchor < 10
        ]

        usage_date = re.match(r"\d{4}/\d{2}/\d{2}", date_item["text"]).group()
        usage_date_str = usage_date.replace("/", "-")

        # 金額 (x≈470-510, 数字のみ)
        amount_items = [
            it for it in row_items if 465 < it["x0"] < 515 and re.search(r"\d", it["text"])
        ]
        amount = None
        if amount_items:
            raw = re.sub(r"[,，\s]", "", amount_items[0]["text"])
            if re.fullmatch(r"\d+", raw):
                amount = int(raw)

        # 税率 (x≈740-770)
        tax_items = [it for it in row_items if 735 < it["x0"] < 775 and "%" in it["text"]]
        tax_rate_str = tax_items[0]["text"] if tax_items else "10%"
        tax_rate_num = int(re.sub(r"[^0-9]", "", tax_rate_str)) / 100

        # PJコード (x≈25-95, "(8桁数字)" を含む)
        pj_items = [
            it
            for it in row_items
            if 20 < it["x0"] < 100 and re.search(r"\((\d{8})\)", it["text"])
        ]
        pj_code = None
        if pj_items:
            m = re.search(r"\((\d{8})\)", pj_items[0]["text"])
            if m:
                pj_code = m.group(1)

        # 部署コード (x≈410-460, "(5桁数字)" を含む)
        dept_items = [
            it
            for it in row_items
            if 405 < it["x0"] < 465 and re.search(r"\((\d{5})\)", it["text"])
        ]
        dept_code = None
        if dept_items:
            m = re.search(r"\((\d{5})\)", dept_items[0]["text"])
            if m:
                dept_code = m.group(1)

        # 参照ファイル名 (x≈25-95, ".pdf" を含む)
        file_items = [
            it
            for it in row_items
            if 20 < it["x0"] < 100 and ".pdf" in it["text"].lower()
        ]
        ref_filename = file_items[0]["text"].strip() if file_items else None

        # インボイス番号 (x≈700-770, "T" + 13桁数字)
        invoice_items = [
            it
            for it in row_items
            if 700 < it["x0"] < 775 and re.match(r"T\d{10,}", it["text"])
        ]
        invoice_no = invoice_items[0]["text"] if invoice_items else None

        # 実際のファイルに照合
        source_file, vendor_name, expense_type = find_actual_file(
            ref_filename or "", apply_month, date_counter
        )

        # 消費税額
        tax_amount = round(amount * tax_rate_num / (1 + tax_rate_num)) if amount else None

        now = datetime.now().isoformat()
        records.append(
            {
                "id": str(uuid.uuid4()),
                "pj_no": pj_code,
                "pj_name": None,
                "expense_item": expense_type,
                "expense_item_code": None,
                "vendor_name": vendor_name,
                "apply_month": apply_month,
                "usage_date": usage_date_str,
                "total_amount": amount,
                "tax_amount": tax_amount,
                "department_code": dept_code,
                "source_file": source_file,
                "source_file_id": None,
                "status": "confirmed",
                "raw_text": ref_filename,
                "invoice_no": invoice_no,
                "created_at": now,
                "updated_at": now,
            }
        )

    return records


# -------- メイン --------
def main():
    parser = argparse.ArgumentParser(description="楽々精算PDFを解析してreceipts.jsonに追記")
    parser.add_argument("--dry-run", action="store_true", help="Driveに書き込まず結果をJSONで出力")
    parser.add_argument("--pdf-dir", default=str(PDF_DIR_DEFAULT), help="PDFが入ったディレクトリ")
    parser.add_argument("--out", default=None, help="dry-run時の出力ファイル (省略時はstdout)")
    args = parser.parse_args()

    pdf_dir = Path(args.pdf_dir)
    pdf_files = sorted(pdf_dir.glob("out*.pdf"))
    if not pdf_files:
        print(f"PDFが見つかりません: {pdf_dir}/out*.pdf")
        sys.exit(1)

    print(f"対象PDF: {[f.name for f in pdf_files]}")

    all_records = []
    for pdf_path in pdf_files:
        print(f"\n--- {pdf_path.name} ---")
        records = parse_pdf(pdf_path)
        print(f"  {len(records)}件抽出")
        all_records.extend(records)

    print(f"\n合計: {len(all_records)}件")

    if args.dry_run:
        output = json.dumps(all_records, ensure_ascii=False, indent=2)
        if args.out:
            Path(args.out).write_text(output, encoding="utf-8")
            print(f"出力: {args.out}")
        else:
            print(output)
        return

    # Drive の既存データとマージ（id重複はスキップ）
    print("\nDriveに接続中...")
    service = get_drive_service()
    existing = drive_read_json(service, SAITO_FOLDER_ID, RECEIPTS_FILENAME)
    existing_ids = {r["id"] for r in existing}
    new_records = [r for r in all_records if r["id"] not in existing_ids]
    merged = existing + new_records

    # apply_month 昇順、同月内は usage_date 昇順でソート
    merged.sort(key=lambda r: (r.get("apply_month") or "", r.get("usage_date") or ""))

    drive_write_json(service, SAITO_FOLDER_ID, RECEIPTS_FILENAME, merged)
    print(f"完了: 既存{len(existing)}件 + 新規{len(new_records)}件 = {len(merged)}件")


if __name__ == "__main__":
    main()
