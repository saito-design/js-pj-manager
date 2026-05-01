import { NextRequest, NextResponse } from 'next/server';
import { loadJsonByName, getDataFolderId, saveJsonFile } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import type { ReceiptSaito } from '@/types';

export const dynamic = 'force-dynamic';

async function loadExpenses(folderId: string): Promise<ReceiptSaito[]> {
  try {
    const data = await loadJsonByName<ReceiptSaito[] | { receipts: ReceiptSaito[] }>('receipts.json', folderId);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && 'receipts' in data) return data.receipts;
    return [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const folderId = getDataFolderId();
    const { searchParams } = new URL(req.url);
    const apply_month = searchParams.get('apply_month');
    const pj_no = searchParams.get('pj_no');
    const status = searchParams.get('status');

    let expenses = await loadExpenses(folderId);
    if (apply_month) expenses = expenses.filter(r => r.apply_month === apply_month);
    if (pj_no) expenses = expenses.filter(r => r.pj_no === pj_no);
    if (status) expenses = expenses.filter(r => r.status === status);

    expenses.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return NextResponse.json({ expenses, total: expenses.length });
  } catch (e) {
    console.error('GET expenses error:', e);
    return NextResponse.json({ error: '経費一覧の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const folderId = getDataFolderId();
    const body = await req.json() as Partial<ReceiptSaito>;
    const expenses = await loadExpenses(folderId);
    expenses.push(body as ReceiptSaito);
    await saveJsonFile('receipts.json', expenses, folderId);
    return NextResponse.json({ expense: body });
  } catch (e) {
    console.error('POST expenses error:', e);
    return NextResponse.json({ error: '経費の追加に失敗しました' }, { status: 500 });
  }
}
