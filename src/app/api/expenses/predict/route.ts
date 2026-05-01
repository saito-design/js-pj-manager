import { NextRequest, NextResponse } from 'next/server';
import { loadJsonByName, getDataFolderId } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import { computePrediction, loadScheduleByDate } from '@/lib/prediction';
import type { ReceiptSaito } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const vendor = (searchParams.get('vendor_name') || '').trim();
    const usageDate = (searchParams.get('usage_date') || '').trim();
    const pjNo = (searchParams.get('pj_no') || '').trim() || null;
    const clientName = (searchParams.get('client_name') || '').trim() || null;
    const taxRateStr = (searchParams.get('tax_rate') || '').trim();
    const taxRate = taxRateStr ? Number(taxRateStr) : null;

    let schedMatched: { PJコード?: string; 得意先名?: string; 件名?: string; date?: string }[] = [];
    if (usageDate) {
      try { schedMatched = await loadScheduleByDate(usageDate); } catch (e) { console.error('schedule load failed:', e); }
    }

    const folderId = getDataFolderId();
    let expenses: ReceiptSaito[] = [];
    try {
      const d = await loadJsonByName<ReceiptSaito[]>('receipts.json', folderId);
      expenses = Array.isArray(d) ? d : [];
    } catch { expenses = []; }

    const result = computePrediction(vendor, usageDate, expenses, schedMatched, {
      pj_no: pjNo,
      client_name: clientName,
      tax_rate: taxRate,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error('GET predict error:', e);
    return NextResponse.json({ error: '予測に失敗しました' }, { status: 500 });
  }
}
