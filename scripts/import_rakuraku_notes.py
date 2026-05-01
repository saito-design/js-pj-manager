"""楽々精算の伝票PDF（multiOutput.pdf 等）から摘要(notes)を抽出して
receipts.json の notes フィールドを更新する。

使い方:
  python import_rakuraku_notes.py "C:/Users/.../multiOutput.pdf" [...]
"""
import argparse
import json
import os
import re
import sys
from io import BytesIO
from pathlib import Path

import fitz  # pymupdf
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload

sys.stdout.reconfigure(encoding="utf-8")

SAITO_DATA_FOLDER = "1LdM1jlSQniJ4nfWiZ3vKsIlIM_8AHveP"
RECEIPTS = "receipts.json"

ENV = Path(r"C:\dev\js-pj-manager\.env.local")


def load_env():
    text = ENV.read_text(encoding="utf-8")
    for line in text.splitlines():
        if "=" not in line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        if k.strip() not in os.environ:
            os.environ[k.strip()] = v


def get_drive():
    email = os.environ["GOOGLE_SERVICE_ACCOUNT_EMAIL"].strip().strip('"')
    key = os.environ["GOOGLE_PRIVATE_KEY"]
    if key.startswith('"') and key.endswith('"'):
        key = key[1:-1]
    key = key.replace("\\n", "\n")
    creds = service_account.Credentials.from_service_account_info(
        {"type": "service_account", "client_email": email, "private_key": key,
         "token_uri": "https://oauth2.googleapis.com/token"},
        scopes=["https://www.googleapis.com/auth/drive"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def fetch_receipts(drive):
    res = drive.files().list(
        q=f"name='{RECEIPTS}' and '{SAITO_DATA_FOLDER}' in parents and trashed=false",
        fields="files(id)",
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute()
    files = res.get("files", [])
    if not files:
        raise RuntimeError("receipts.json が見つかりません")
    fid = files[0]["id"]
    req = drive.files().get_media(fileId=fid, supportsAllDrives=True)
    buf = BytesIO()
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    return fid, json.loads(buf.read().decode("utf-8"))


def upload_receipts(drive, file_id, data):
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    media = MediaIoBaseUpload(BytesIO(body), mimetype="application/json")
    drive.files().update(fileId=file_id, media_body=media, supportsAllDrives=True).execute()


def parse_pdf(pdf_path: Path) -> list[dict]:
    """1冊の伝票PDFをパースして明細レコードのリストを返す"""
    doc = fitz.open(str(pdf_path))
    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"

    # 明細パターン: 番号(行頭) 日付 内訳(=分類) 単価 数量 金額 税率
    # PJ名行 + (PJ番号)
    # 部署
    # 支払方法
    # 元ファイル名（複数行になることがある.pdfで終わる）
    # 摘要
    # T番号 (任意)
    #
    # 全体テキストから明細単位で分割：番号は1〜2桁の整数で行頭にくる
    rows: list[dict] = []
    lines = [ln for ln in full_text.splitlines() if ln.strip()]

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        # 「No.」 セクション、ヘッダ行はスキップ
        if not re.fullmatch(r"\d{1,2}", line):
            i += 1
            continue
        # 番号後に日付が続くはず
        if i + 1 >= len(lines):
            break
        date_line = lines[i + 1].strip()
        m_date = re.match(r"(\d{4}/\d{2}/\d{2})", date_line)
        if not m_date:
            i += 1
            continue
        date = m_date.group(1).replace("/", "-")
        # 内訳
        category_label = lines[i + 2].strip() if i + 2 < len(lines) else ""
        # 単価, 数量, 金額, 税率
        # PDFテキストは数値が同じ行になく1行ずつ並ぶ：単価, 数量, 金額, 税率
        try:
            unit = int(lines[i + 3].replace(",", "").strip())
            qty = int(lines[i + 4].strip())
            total = int(lines[i + 5].replace(",", "").strip())
            tax_rate = lines[i + 6].strip()
        except (ValueError, IndexError):
            i += 1
            continue
        # 証票（○ または -） 行
        offset = 7
        # ○ がある場合スキップ
        if i + offset < len(lines) and lines[i + offset].strip() in ("○", "-"):
            offset += 1
        # PJ行 ... (PJコード) で終わる
        pj_line = lines[i + offset].strip() if i + offset < len(lines) else ""
        m_pj = re.search(r"\((\d{8})\)\s*$", pj_line)
        pj_no = m_pj.group(1) if m_pj else None
        # 部署
        offset += 1
        dept_line = lines[i + offset].strip() if i + offset < len(lines) else ""
        m_dept = re.search(r"\((\d{5})\)\s*$", dept_line)
        dept_code = m_dept.group(1) if m_dept else None
        # 支払方法
        offset += 1
        # 元ファイル名（複数行 .pdf まで連結）
        offset += 1
        filename_parts: list[str] = []
        while i + offset < len(lines):
            part = lines[i + offset].strip()
            filename_parts.append(part)
            if part.endswith(".pdf"):
                break
            offset += 1
        filename = "".join(filename_parts).strip()
        # 摘要（次の行）
        offset += 1
        notes = lines[i + offset].strip() if i + offset < len(lines) else ""
        # T番号（任意）
        offset += 1
        t_line = lines[i + offset].strip() if i + offset < len(lines) else ""
        invoice_no = t_line if re.fullmatch(r"T\d+", t_line) else None

        rows.append({
            "no": int(line),
            "date": date,
            "category_label": category_label,
            "total": total,
            "tax_rate": tax_rate,
            "pj_no": pj_no,
            "dept_code": dept_code,
            "filename": filename,
            "notes": notes,
            "invoice_no": invoice_no,
        })
        # 次の明細へ：次の番号行を探す
        i += offset + 1
    return rows


def normalize_filename(s: str) -> str:
    """PDFテキスト内のファイル名と receipts.json の source_file/raw_text を比較しやすく正規化"""
    if not s:
        return ""
    # 全角/半角空白除去、改行除去、.pdf 大小文字
    return re.sub(r"\s+", "", s).replace("　", "").lower()


CATEGORY_FROM_FILENAME = [
    ("講師食事代", "講師食事代"),
    ("宿泊調査", "宿泊調査費"),
    ("宿泊", "宿泊代"),
    ("調査費", "調査費"),
    ("調査用", "調査費"),
    ("タクシー", "タクシー代"),
    ("新幹線", "新幹線代"),
    ("レンタカー", "レンタカー代"),
    ("高速", "高速代"),
    ("駐車", "駐車場代"),
    ("コピー", "コピー代"),
    ("書籍", "書籍代"),
    ("文具", "文具代"),
    ("通信", "通信費"),
]

def guess_category_from_filename(fn: str) -> str | None:
    for kw, cat in CATEGORY_FROM_FILENAME:
        if kw in fn:
            return cat
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="+", help="楽々精算 伝票PDF（複数可）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--add-missing", action="store_true", help="未マッチ分をreceipts.jsonに新規追加")
    args = ap.parse_args()

    load_env()
    drive = get_drive()

    print("[Drive] receipts.json 取得中...")
    file_id, receipts = fetch_receipts(drive)
    print(f"  既存: {len(receipts)}件")

    # 既存レコードを raw_text/source_file の正規化キーで索引
    by_filename: dict[str, list[dict]] = {}
    for r in receipts:
        for k in (r.get("raw_text"), r.get("source_file")):
            if not k:
                continue
            nk = normalize_filename(k)
            by_filename.setdefault(nk, []).append(r)

    all_pdf_rows: list[dict] = []
    for pdf in args.pdfs:
        rows = parse_pdf(Path(pdf))
        print(f"[PDF] {pdf}: {len(rows)} 件抽出")
        all_pdf_rows.extend(rows)

    matched = 0
    no_match = []
    for row in all_pdf_rows:
        if not row["notes"]:
            continue
        nk = normalize_filename(row["filename"])
        cands = by_filename.get(nk, [])
        if not cands:
            # 部分一致
            for k, v in by_filename.items():
                if nk and (nk in k or k in nk):
                    cands = v
                    break
        if not cands:
            # 日付+金額+PJ で照合
            cands = [r for r in receipts
                     if r.get("usage_date") == row["date"]
                     and r.get("total_amount") == row["total"]
                     and (r.get("pj_no") or "") == (row["pj_no"] or "")]
        if not cands:
            no_match.append(row)
            continue
        if len(cands) > 1:
            cands = [r for r in cands if r.get("usage_date") == row["date"]] or cands
        target = cands[0]
        if target.get("notes") != row["notes"]:
            target["notes"] = row["notes"]
            matched += 1

    added = 0
    if args.add_missing and no_match:
        import datetime, uuid
        for n in no_match:
            now = datetime.datetime.now().isoformat()
            cat_label = n.get("category_label") or ""
            # 楽々精算コードを推定
            code_map = {
                "業務雑費": "601",
                "業務雑費　＜非・外＞": "599",
                "業務雑費 ＜非・外＞": "599",
                "調査費（業務雑費）": "3267",
                "調査費（業務雑費＜非・外＞）": "3271",
                "業務雑費【軽】（8%）": "5331",
                "業務雑費(免税/経過80)": "6009",
            }
            expense_item_code = code_map.get(cat_label.strip())
            tax_rate_num = 0.10 if "10%" in (n.get("tax_rate") or "") else (0.08 if "8" in (n.get("tax_rate") or "") else None)
            tax_amount = round(n["total"] * tax_rate_num / (1 + tax_rate_num)) if tax_rate_num and n["total"] else None
            apply_month = n["date"][:7]
            cat = guess_category_from_filename(n.get("filename") or "")
            entry = {
                "id": str(uuid.uuid4()),
                "pj_no": n.get("pj_no"),
                "pj_name": None,
                "client_name": None,
                "expense_item": cat_label or None,
                "expense_item_code": expense_item_code,
                "category": cat,
                "vendor_name": None,
                "apply_month": apply_month,
                "usage_date": n["date"],
                "invoice_no": n.get("invoice_no"),
                "total_amount": n["total"],
                "tax_amount": tax_amount,
                "tax_rate": tax_rate_num,
                "tax_category": "10" if tax_rate_num == 0.10 else ("8" if tax_rate_num == 0.08 else None),
                "extra_tax_labels": [],
                "department_code": n.get("dept_code"),
                "notes": n.get("notes"),
                "source_file": n.get("filename"),
                "source_file_id": None,
                "status": "confirmed",
                "raw_text": n.get("filename"),
                "created_at": now,
                "updated_at": now,
            }
            receipts.append(entry)
            added += 1

    print(f"\n[結果] notes 更新: {matched} 件 / 新規追加: {added} 件 / 未マッチで未追加: {len(no_match) - added} 件")
    if no_match:
        print("[未マッチサンプル]")
        for n in no_match[:5]:
            print(f"  {n['date']} {n['filename']} -> {n['notes']}")

    if args.dry_run:
        print("[DRY-RUN] Drive へは書き込みません")
        return

    if matched > 0 or added > 0:
        upload_receipts(drive, file_id, receipts)
        print(f"[OK] receipts.json 更新（notes={matched}件、新規={added}件）")
    else:
        print("[NOTE] 更新なし")


if __name__ == "__main__":
    main()
