import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { loadJsonByName, getDataFolderId, saveJsonFile, renameFile, deleteFile, downloadFile } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import { buildSaitoFilename } from '@/lib/filename';
import { imageBufferToPdfBuffer, pdfizeFilename } from '@/lib/imageToPdf';
import type { ReceiptSaito } from '@/types';

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

export const dynamic = 'force-dynamic';

async function loadExpenses(folderId: string): Promise<ReceiptSaito[]> {
  try {
    const data = await loadJsonByName<ReceiptSaito[]>('receipts.json', folderId);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const folderId = getDataFolderId();
    const updates = await req.json();
    const expenses = await loadExpenses(folderId);
    const idx = expenses.findIndex(r => r.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: '対象の経費が見つかりません' }, { status: 404 });
    }

    const allowed = [
      'pj_no', 'pj_name', 'client_name', 'expense_item', 'expense_item_code', 'category',
      'vendor_name', 'apply_month', 'usage_date', 'invoice_no',
      'total_amount', 'tax_amount', 'tax_rate', 'tax_category', 'extra_tax_labels',
      'department_code', 'notes', 'status',
    ] as const;
    const before = { ...expenses[idx] };
    for (const k of allowed) {
      if (k in updates) (expenses[idx] as unknown as Record<string, unknown>)[k] = updates[k];
    }
    expenses[idx].updated_at = new Date().toISOString();

    const e = expenses[idx];

    // 確定（pending→confirmed）に変わり、まだ画像形式なら PDF に変換
    const justConfirmed = before.status !== 'confirmed' && e.status === 'confirmed';
    const isImage = /\.(jpe?g|png|webp)$/i.test(e.source_file || '');
    if (justConfirmed && isImage && e.source_file_id && e.source_file) {
      try {
        const buf = await downloadFile(e.source_file_id);
        const ext = (e.source_file.match(/\.([^.]+)$/) || ['', 'jpg'])[1].toLowerCase();
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        const pdfBuf = await imageBufferToPdfBuffer(buf, mime);
        const pdfName = pdfizeFilename(e.source_file);
        const drive = getDriveWrite();
        const uploadsId = process.env.UPLOADS_FOLDER_SAITO!;
        const created = await drive.files.create({
          requestBody: { name: pdfName, parents: [uploadsId] },
          media: { mimeType: 'application/pdf', body: Readable.from(pdfBuf) },
          fields: 'id', supportsAllDrives: true,
        });
        // 旧JPGをゴミ箱
        await drive.files.update({
          fileId: e.source_file_id,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
        e.source_file = pdfName;
        e.source_file_id = created.data.id || null;
      } catch (err) {
        console.error('confirm時のPDF変換失敗 (non-fatal):', err);
      }
    }

    const nameKeys: (keyof ReceiptSaito)[] = ['apply_month', 'pj_no', 'client_name', 'category', 'vendor_name', 'usage_date', 'extra_tax_labels'];
    const changed = nameKeys.some(k => JSON.stringify(before[k]) !== JSON.stringify(e[k]));
    if (changed && e.source_file_id && e.source_file) {
      try {
        const newName = buildSaitoFilename(
          { apply_month: e.apply_month, pj_no: e.pj_no, client_name: e.client_name, category: e.category, vendor_name: e.vendor_name, usage_date: e.usage_date, extra_tax_labels: e.extra_tax_labels || [] },
          e.source_file,
        );
        await renameFile(e.source_file_id, newName);
        e.source_file = newName;
      } catch (err) {
        console.error('Drive rename failed (non-fatal):', err);
      }
    }

    await saveJsonFile('receipts.json', expenses, folderId);
    return NextResponse.json(expenses[idx]);
  } catch (e) {
    console.error('PUT expenses/[id] error:', e);
    return NextResponse.json({ error: '経費の更新に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const folderId = getDataFolderId();
    const expenses = await loadExpenses(folderId);
    const target = expenses.find(r => r.id === id);
    const next = expenses.filter(r => r.id !== id);
    await saveJsonFile('receipts.json', next, folderId);

    // Drive上の元ファイルも削除（失敗しても全体は成功扱い）
    if (target?.source_file_id) {
      try {
        await deleteFile(target.source_file_id);
      } catch (e) {
        console.error('Drive file delete failed (non-fatal):', e);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE expenses/[id] error:', e);
    return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
  }
}
