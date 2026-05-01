import { NextRequest, NextResponse } from 'next/server';
import { loadJsonByName, getDataFolderId } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import type { ReceiptSaito, PredictionResult } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const vendor = (searchParams.get('vendor_name') || '').trim();

    const empty: PredictionResult = { pj_no: null, expense_item_code: null, vendor_name: vendor || null, source: 'none', confidence: 0 };
    if (!vendor) return NextResponse.json(empty);

    const folderId = getDataFolderId();
    let expenses: ReceiptSaito[] = [];
    try {
      const data = await loadJsonByName<ReceiptSaito[]>('receipts.json', folderId);
      expenses = Array.isArray(data) ? data : [];
    } catch {
      expenses = [];
    }

    const nl = vendor.toLowerCase();
    const matched = expenses.filter(e => (e.vendor_name || '').toLowerCase().includes(nl) || nl.includes((e.vendor_name || '').toLowerCase()));
    if (matched.length === 0) return NextResponse.json(empty);

    const pjCount = new Map<string, number>();
    const itCount = new Map<string, number>();
    for (const m of matched) {
      if (m.pj_no) pjCount.set(m.pj_no, (pjCount.get(m.pj_no) || 0) + 1);
      if (m.expense_item_code) itCount.set(m.expense_item_code, (itCount.get(m.expense_item_code) || 0) + 1);
    }
    const top = (m: Map<string, number>) => {
      let bk: string | null = null, bv = 0;
      m.forEach((v, k) => { if (v > bv) { bv = v; bk = k; } });
      return { key: bk, freq: bv };
    };
    const tp = top(pjCount), ti = top(itCount);

    const confidence = matched.length >= 3 ? 0.9 : matched.length >= 2 ? 0.7 : 0.5;
    const result: PredictionResult = {
      pj_no: tp.key,
      expense_item_code: ti.key,
      vendor_name: vendor,
      source: 'history',
      confidence,
    };
    return NextResponse.json(result);
  } catch (e) {
    console.error('GET predict error:', e);
    return NextResponse.json({ error: '予測に失敗しました' }, { status: 500 });
  }
}
