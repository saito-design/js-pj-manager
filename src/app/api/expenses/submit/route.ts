import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { loadJsonByName, getDataFolderId, saveJsonFile, renameFile } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import { extractReceipt } from '@/lib/claude';
import { buildSaitoFilename, getCurrentApplyMonth } from '@/lib/filename';
import { computePrediction, loadScheduleByDate } from '@/lib/prediction';
import type { ReceiptSaito } from '@/types';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

function clean(v: string | undefined): string | undefined {
  if (!v) return undefined;
  let c = v.trim();
  if (c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1);
  return c.replace(/\\n/g, '\n');
}

function getDriveWrite() {
  const auth = new JWT({
    email: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: clean(process.env.GOOGLE_PRIVATE_KEY),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function uploadToDrive(buffer: Buffer, filename: string, mimeType: string, parentId: string): Promise<string> {
  const drive = getDriveWrite();
  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType, body: stream },
    fields: 'id',
    supportsAllDrives: true,
  });
  return res.data.id!;
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const uploadsId = process.env.UPLOADS_FOLDER_SAITO;
    if (!uploadsId) return NextResponse.json({ error: 'uploadsフォルダが設定されていません' }, { status: 500 });
    const dataFolderId = getDataFolderId();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'fileが必要です' }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'ファイルサイズが大きすぎます (20MB上限)' }, { status: 400 });

    const apply_month = (form.get('apply_month') as string) || getCurrentApplyMonth();
    const formPjNo = (form.get('pj_no') as string) || null;
    const formPjName = (form.get('pj_name') as string) || null;
    const formClientName = (form.get('client_name') as string) || null;
    const formExpenseItem = (form.get('expense_item') as string) || null;
    const formExpenseItemCode = (form.get('expense_item_code') as string) || null;
    const formDepartmentCode = (form.get('department_code') as string) || null;

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const origName = file.name || `upload_${Date.now()}`;

    const tempId = await uploadToDrive(buf, origName, mime, uploadsId);

    let extracted: Awaited<ReturnType<typeof extractReceipt>> | null = null;
    try {
      extracted = await extractReceipt(buf, mime);
    } catch (e) {
      console.error('Claude extract failed:', e);
    }

    const vendor_name = extracted?.store_name || null;
    const usage_date = extracted?.date || null;
    const total_amount = extracted?.total_amount ?? null;
    const tax_rate = extracted?.tax_rate ?? null;
    const tax_category: '10' | '8' | null =
      tax_rate === 0.10 ? '10' : tax_rate === 0.08 ? '8' : null;
    // 消費税: OCRが取れていればそれを使う。なければ total × rate / (1+rate) で逆算
    let tax_amount = extracted?.tax_amount ?? null;
    if (tax_amount == null && total_amount != null && tax_rate != null && tax_rate > 0) {
      tax_amount = Math.round(total_amount * tax_rate / (1 + tax_rate));
    }

    // 既存receipts.json読み込み（予測の履歴ソース＋追記用）
    let expenses: ReceiptSaito[] = [];
    try {
      const data = await loadJsonByName<ReceiptSaito[]>('receipts.json', dataFolderId);
      expenses = Array.isArray(data) ? data : [];
    } catch {
      expenses = [];
    }

    // 予測：未指定項目をスケジュール＋履歴から自動推定
    let pj_no = formPjNo;
    let pj_name = formPjName;
    let client_name = formClientName;
    let expense_item = formExpenseItem;
    let expense_item_code = formExpenseItemCode;
    let department_code = formDepartmentCode;
    try {
      const schedMatched = usage_date ? await loadScheduleByDate(usage_date) : [];
      // pj_no/client_nameがスケジュールから決まる順序を考慮：先に1回呼んでpj_no確定、その確定値を ctx で再呼出
      const firstPred = computePrediction(vendor_name || '', usage_date || '', expenses, schedMatched, { tax_rate });
      const pred = computePrediction(vendor_name || '', usage_date || '', expenses, schedMatched, {
        pj_no: pj_no || firstPred.pj_no,
        client_name: client_name || firstPred.client_name,
        tax_rate,
      });
      if (!pj_no && pred.pj_no) {
        pj_no = pred.pj_no;
        pj_name = pred.pj_name || pj_name;
      }
      if (!client_name && pred.client_name) {
        client_name = pred.client_name;
      }
      if (!expense_item_code && pred.expense_item_code) {
        expense_item_code = pred.expense_item_code;
        // 経費項目名も履歴から取得
        if (!expense_item) {
          const fromHist = expenses.find(e => e.expense_item_code === pred.expense_item_code && e.expense_item);
          if (fromHist) expense_item = fromHist.expense_item;
        }
      }
      if (!department_code && pred.department_code) {
        department_code = pred.department_code;
      }
    } catch (e) {
      console.error('predict at submit failed (non-fatal):', e);
    }

    const newFilename = buildSaitoFilename(
      { apply_month, pj_no, client_name, expense_item, vendor_name, usage_date, extra_tax_labels: [] },
      origName,
    );

    try {
      await renameFile(tempId, newFilename);
    } catch (e) {
      console.error('Rename failed (non-fatal):', e);
    }

    const now = new Date().toISOString();
    const entry: ReceiptSaito = {
      id: randomUUID(),
      pj_no,
      pj_name,
      client_name,
      expense_item,
      expense_item_code,
      vendor_name,
      apply_month,
      usage_date,
      total_amount,
      tax_amount,
      tax_rate,
      tax_category,
      extra_tax_labels: [],
      department_code,
      source_file: newFilename,
      source_file_id: tempId,
      status: 'pending',
      raw_text: extracted ? JSON.stringify(extracted) : null,
      created_at: now,
      updated_at: now,
    };

    expenses.push(entry);
    await saveJsonFile('receipts.json', expenses, dataFolderId);

    return NextResponse.json({ expense: entry, extracted });
  } catch (e) {
    console.error('POST submit error:', e);
    const msg = e instanceof Error ? e.message : '送信に失敗しました';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
