import SaitoManage from '@/components/SaitoManage'

export default function HomePage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">PJ経費管理</h1>
      </header>
      <SaitoManage />
    </div>
  )
}
