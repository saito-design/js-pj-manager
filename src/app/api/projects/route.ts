import { NextRequest, NextResponse } from 'next/server';
import { loadProjects } from '@/lib/projects';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const projects = await loadProjects();
    return NextResponse.json({ projects }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('GET projects error:', e);
    return NextResponse.json({ error: 'PJ一覧の取得に失敗しました' }, { status: 500 });
  }
}
