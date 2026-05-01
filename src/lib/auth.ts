import { NextRequest } from 'next/server';

export function requireAuth(
  _req: NextRequest,
): { success: true } | { success: false; error: string } {
  // 個人用アプリのため認証はスキップ（将来: iron-session でパスワード保護を追加）
  return { success: true };
}
