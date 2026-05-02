import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { loadJsonByName, saveJsonFile, getDataFolderId, downloadFile } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import { imageBufferToPdfBuffer, pdfizeFilename } from '@/lib/imageToPdf';
import { buildSaitoFilename } from '@/lib/filename';
import type { ReceiptSaito } from '@/types';

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

async function loadExpenses(folderId: string): Promise<ReceiptSaito[]> {
  try {
    const data = await loadJsonByName<ReceiptSaito[]>('receipts.json', folderId);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// GET: Drive上の画像/PDFバイナリを返す
export async function GET(
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
    if (!target?.source_file_id) {
      return NextResponse.json({ error: 'ファイルがありません' }, { status: 404 });
    }
    const buf = await downloadFile(target.source_file_id);
    const ext = (target.source_file || '').split('.').pop()?.toLowerCase() || '';
    const mime = ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : 'image/jpeg';
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e) {
    console.error('GET file error:', e);
    return NextResponse.json({ error: 'ファイル取得に失敗' }, { status: 500 });
  }
}

// PUT: 新しい画像で差し替え（元ファイルをtrash→新規アップロード→source_file_id更新）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'fileが必要です' }, { status: 400 });

    const folderId = getDataFolderId();
    const uploadsId = process.env.UPLOADS_FOLDER_SAITO;
    if (!uploadsId) return NextResponse.json({ error: 'uploadsフォルダ未設定' }, { status: 500 });

    const expenses = await loadExpenses(folderId);
    const idx = expenses.findIndex(r => r.id === id);
    if (idx === -1) return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
    const target = expenses[idx];

    const drive = getDriveWrite();
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || 'image/jpeg';
    // クロップ差し替えは元形式（JPG/PDF）のまま保存。PDF変換は確定時に実施
    const filename = target.source_file || file.name || `replace_${Date.now()}.jpg`;

    const stream = Readable.from(buf);
    const newFile = await drive.files.create({
      requestBody: { name: filename, parents: [uploadsId] },
      media: { mimeType: mime, body: stream },
      fields: 'id',
      supportsAllDrives: true,
    });

    // 旧ファイルをゴミ箱へ
    if (target.source_file_id) {
      try {
        await drive.files.update({
          fileId: target.source_file_id,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        });
      } catch (e) {
        console.error('old file trash failed (non-fatal):', e);
      }
    }

    expenses[idx].source_file_id = newFile.data.id || null;
    expenses[idx].updated_at = new Date().toISOString();
    await saveJsonFile('receipts.json', expenses, folderId);
    return NextResponse.json(expenses[idx]);
  } catch (e) {
    console.error('PUT file error:', e);
    return NextResponse.json({ error: '差し替えに失敗' }, { status: 500 });
  }
}
