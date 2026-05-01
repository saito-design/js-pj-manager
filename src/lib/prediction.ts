import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import type { ReceiptSaito } from '@/types';

export interface PredictResult {
  pj_no: string | null;
  pj_name: string | null;
  expense_item_code: string | null;
  source: 'schedule' | 'history' | 'both' | 'none';
  confidence: number;
  candidates: {
    schedule: { pj_no: string; client_name: string; subject: string }[];
    history: { pj_no: string | null; expense_item_code: string | null; count: number }[];
  };
}

interface ScheduleRecord {
  PJコード?: string;
  得意先名?: string;
  件名?: string;
  date?: string;
}

function clean(v: string | undefined): string | undefined {
  if (!v) return undefined;
  let c = v.trim();
  if (c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1);
  return c.replace(/\\n/g, '\n');
}

export async function loadScheduleByDate(date: string): Promise<ScheduleRecord[]> {
  const folderId = process.env.SCHEDULE_FOLDER_ID;
  if (!folderId || !date) return [];
  const auth = new JWT({
    email: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: clean(process.env.GOOGLE_PRIVATE_KEY),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });
  const list = await drive.files.list({
    q: `name='schedule.json' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = list.data.files || [];
  if (files.length === 0) return [];
  const res = await drive.files.get(
    { fileId: files[0].id!, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' },
  );
  const data = JSON.parse(res.data as string);
  const records: ScheduleRecord[] = data.records || [];
  return records.filter(r => r.date === date && (r.PJコード || '').trim());
}

export function computePrediction(
  vendor: string,
  usageDate: string,
  expenses: ReceiptSaito[],
  schedMatched: ScheduleRecord[],
): PredictResult {
  const empty: PredictResult = {
    pj_no: null, pj_name: null, expense_item_code: null,
    source: 'none', confidence: 0,
    candidates: { schedule: [], history: [] },
  };

  const scheduleCandidates = Array.from(
    new Map(schedMatched.map(r => [r.PJコード!, {
      pj_no: r.PJコード!,
      client_name: r.得意先名 || '',
      subject: r.件名 || '',
    }])).values()
  );

  const v = (vendor || '').toLowerCase();
  const historyMatched = v
    ? expenses.filter(e => {
        const ev = (e.vendor_name || '').toLowerCase();
        return ev && (ev.includes(v) || v.includes(ev));
      })
    : [];

  const pjCount = new Map<string, number>();
  const itCount = new Map<string, number>();
  const pjItPair = new Map<string, { pj_no: string | null; expense_item_code: string | null; count: number }>();
  for (const m of historyMatched) {
    if (m.pj_no) pjCount.set(m.pj_no, (pjCount.get(m.pj_no) || 0) + 1);
    if (m.expense_item_code) itCount.set(m.expense_item_code, (itCount.get(m.expense_item_code) || 0) + 1);
    const k = `${m.pj_no || ''}|${m.expense_item_code || ''}`;
    const cur = pjItPair.get(k);
    pjItPair.set(k, { pj_no: m.pj_no, expense_item_code: m.expense_item_code, count: (cur?.count || 0) + 1 });
  }
  const topKey = (m: Map<string, number>): string | null => {
    let bk: string | null = null, bv = 0;
    m.forEach((v, k) => { if (v > bv) { bv = v; bk = k; } });
    return bk;
  };
  const histTopPj = topKey(pjCount);
  const histTopIt = topKey(itCount);

  const schedTopPj = scheduleCandidates[0]?.pj_no || null;
  let pj_no: string | null = null;
  let pj_name: string | null = null;
  let source: PredictResult['source'] = 'none';
  let confidence = 0;

  if (schedTopPj && histTopPj && schedTopPj === histTopPj) {
    pj_no = schedTopPj;
    pj_name = scheduleCandidates[0]?.subject || null;
    source = 'both';
    confidence = 0.95;
  } else if (schedTopPj) {
    pj_no = schedTopPj;
    pj_name = scheduleCandidates[0]?.subject || null;
    source = 'schedule';
    confidence = scheduleCandidates.length === 1 ? 0.85 : 0.7;
  } else if (histTopPj) {
    pj_no = histTopPj;
    source = 'history';
    confidence = historyMatched.length >= 3 ? 0.8 : historyMatched.length >= 2 ? 0.6 : 0.4;
  }

  const expense_item_code = histTopIt;

  if (!pj_no && !expense_item_code) return empty;
  return {
    pj_no, pj_name, expense_item_code,
    source, confidence,
    candidates: {
      schedule: scheduleCandidates,
      history: Array.from(pjItPair.values()).sort((a, b) => b.count - a.count).slice(0, 5),
    },
  };
}
