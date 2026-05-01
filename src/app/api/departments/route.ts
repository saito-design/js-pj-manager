import { NextRequest, NextResponse } from 'next/server';
import { loadJsonByName, getDataFolderId } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import type { Department } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const folderId = getDataFolderId();
    let departments: Department[] = [];
    try {
      const data = await loadJsonByName<{ departments: Department[] }>('departments.json', folderId);
      departments = data?.departments || [];
    } catch {
      departments = [];
    }
    return NextResponse.json({ departments });
  } catch (e) {
    console.error('GET departments error:', e);
    return NextResponse.json({ error: '所属部署の取得に失敗しました' }, { status: 500 });
  }
}
