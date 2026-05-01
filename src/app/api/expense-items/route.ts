import { NextRequest, NextResponse } from 'next/server';
import { loadJsonByName, saveJsonFile, getDataFolderId } from '@/lib/drive';
import { requireAuth } from '@/lib/auth';
import type { ExpenseItem } from '@/types';

export const dynamic = 'force-dynamic';

async function loadItems(folderId: string): Promise<ExpenseItem[]> {
  try {
    const data = await loadJsonByName<{ items: ExpenseItem[] }>('expense_items.json', folderId);
    return data?.items || [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const folderId = getDataFolderId();
    const items = await loadItems(folderId);
    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET expense-items error:', e);
    return NextResponse.json({ error: '経費項目の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const body = await req.json() as Partial<ExpenseItem>;
    const code = body.code?.trim();
    const name = body.name?.trim();
    if (!code || !name) {
      return NextResponse.json({ error: 'コードと名称は必須です' }, { status: 400 });
    }

    const folderId = getDataFolderId();
    const items = await loadItems(folderId);

    if (items.some(i => i.code === code)) {
      return NextResponse.json({ error: `コード ${code} は既に存在します` }, { status: 409 });
    }

    const newItem: ExpenseItem = { code, name, category: body.category?.trim() || undefined };
    const updated = [...items, newItem].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    await saveJsonFile('expense_items.json', { items: updated }, folderId);

    return NextResponse.json({ item: newItem, items: updated });
  } catch (e) {
    console.error('POST expense-items error:', e);
    return NextResponse.json({ error: '経費項目の追加に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = requireAuth(req);
    if (!auth.success) return NextResponse.json({ error: auth.error }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    if (!code) return NextResponse.json({ error: 'code は必須です' }, { status: 400 });

    const folderId = getDataFolderId();
    const items = await loadItems(folderId);
    const updated = items.filter(i => i.code !== code);

    if (updated.length === items.length) {
      return NextResponse.json({ error: '該当する経費項目が見つかりません' }, { status: 404 });
    }

    await saveJsonFile('expense_items.json', { items: updated }, folderId);
    return NextResponse.json({ items: updated });
  } catch (e) {
    console.error('DELETE expense-items error:', e);
    return NextResponse.json({ error: '経費項目の削除に失敗しました' }, { status: 500 });
  }
}
