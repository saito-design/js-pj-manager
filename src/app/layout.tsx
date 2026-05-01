import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PJ経費管理',
  description: '斉藤デザイン PJ・経費管理',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
