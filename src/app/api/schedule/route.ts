import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function getScheduleFolderId(): string {
  const id = process.env.SCHEDULE_FOLDER_ID;
  if (!id) throw new Error('SCHEDULE_FOLDER_ID is not configured');
  return id;
}

function getDrive() {
  function clean(v: string | undefined) {
    if (!v) return undefined;
    let s = v.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s.replace(/\\n/g, '\n');
  }
  const auth = new JWT({
    email: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: clean(process.env.GOOGLE_PRIVATE_KEY),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const scheduleFolderId = getScheduleFolderId();
    const drive = getDrive();

    const res = await drive.files.list({
      q: `name='schedule.json' and '${scheduleFolderId}' in parents and trashed=false`,
      fields: 'files(id, modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = res.data.files || [];
    if (files.length === 0) {
      return NextResponse.json({ exists: false, data: null });
    }

    const content = await drive.files.get(
      { fileId: files[0].id!, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' },
    );

    const data = JSON.parse(content.data as string);
    return NextResponse.json({
      exists: true,
      updated_at: data.updated_at ?? null,
      count: data.count ?? 0,
      records: data.records ?? [],
    });
  } catch (e) {
    console.error('GET schedule error:', e);
    return NextResponse.json({ error: 'スケジュールの取得に失敗しました' }, { status: 500 });
  }
}
