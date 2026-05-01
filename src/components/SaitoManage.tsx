'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import QRCode from 'qrcode'
import type { ReceiptSaito, Project, ExpenseItem, Department } from '@/types'

interface ScheduleRecord {
  入力: string; PJコード: string; 得意先名: string
  年: string; 月: string; 日: string; 時間STR: string; 時間END: string
  稼働区分: string; 稼働費: string; 交通費: string; 件名: string; 備考: string
  date: string
}

interface ScheduleData {
  exists: boolean
  updated_at: string | null
  count: number
  records: ScheduleRecord[]
}

function getCurrentApplyMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function SaitoManage() {
  const [expenses, setExpenses] = useState<ReceiptSaito[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [items, setItems] = useState<ExpenseItem[]>([])
  const [depts, setDepts] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [qrSrc, setQrSrc] = useState('')
  const [submitUrl, setSubmitUrl] = useState('')
  const [applyFilter, setApplyFilter] = useState(getCurrentApplyMonth())
  const [pjFilter, setPjFilter] = useState('')
  const [editing, setEditing] = useState<ReceiptSaito | null>(null)

  // スケジュールモーダル
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleData | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleFilter, setScheduleFilter] = useState(getCurrentApplyMonth())

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true)
    try {
      const res = await fetch('/api/schedule')
      const data = await res.json()
      setSchedule(data)
    } catch {
      setSchedule(null)
    } finally {
      setScheduleLoading(false)
    }
  }, [])

  // 経費項目管理用
  const [showItemMgmt, setShowItemMgmt] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [itemSaving, setItemSaving] = useState(false)
  const [itemError, setItemError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (applyFilter) params.set('apply_month', applyFilter)
      if (pjFilter) params.set('pj_no', pjFilter)
      const [e, p, i, d] = await Promise.all([
        fetch(`/api/expenses?${params}`).then(r => r.json()),
        fetch('/api/projects').then(r => r.json()),
        fetch('/api/expense-items').then(r => r.json()),
        fetch('/api/departments').then(r => r.json()),
      ])
      setExpenses(e.expenses || [])
      setProjects(p.projects || [])
      setItems(i.items || [])
      setDepts(d.departments || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データ取得失敗')
    } finally {
      setLoading(false)
    }
  }, [applyFilter, pjFilter])

  useEffect(() => { load() }, [load])

  // QRコード生成（submit URL）
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/submit`
    setSubmitUrl(url)
    QRCode.toDataURL(url, { width: 200, margin: 2 }).then(setQrSrc).catch(() => setQrSrc(''))
  }, [])

  const totalAmount = useMemo(() => expenses.reduce((s, e) => s + (e.total_amount ?? 0), 0), [expenses])

  const updateExpense = async (id: string, patch: Partial<ReceiptSaito>) => {
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('更新失敗')
      const updated = await res.json()
      setExpenses(prev => prev.map(e => e.id === id ? updated : e))
      if (editing?.id === id) setEditing(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新失敗')
    }
  }

  const deleteExpense = async (id: string) => {
    if (!window.confirm('この経費を削除しますか？（Drive上のファイルは残ります）')) return
    try {
      const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' })
      if (res.ok) setExpenses(prev => prev.filter(e => e.id !== id))
    } catch {}
  }

  const addItem = async () => {
    const code = newCode.trim()
    const name = newName.trim()
    if (!code || !name) { setItemError('コードと名称は必須です'); return }
    setItemSaving(true); setItemError('')
    try {
      const res = await fetch('/api/expense-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, category: newCategory.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '追加失敗')
      setItems(data.items)
      setNewCode(''); setNewName(''); setNewCategory('')
    } catch (err) {
      setItemError(err instanceof Error ? err.message : '追加失敗')
    } finally {
      setItemSaving(false)
    }
  }

  const deleteItem = async (code: string) => {
    if (!window.confirm(`経費項目「${code}」を削除しますか？`)) return
    try {
      const res = await fetch(`/api/expense-items?code=${encodeURIComponent(code)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '削除失敗')
      setItems(data.items)
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除失敗')
    }
  }

  return (
    <div className="space-y-6">
      {/* スケジュール確認ボタン */}
      <section className="flex items-center gap-3">
        <button
          onClick={() => { setShowSchedule(true); loadSchedule() }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          📅 スケジュール確認
        </button>
        {schedule?.updated_at && (
          <span className="text-xs text-gray-400">最終取込: {schedule.updated_at.replace('T', ' ')}</span>
        )}
        <span className="text-xs text-gray-300 ml-auto">
          ※ 取込は <code className="bg-gray-100 px-1 rounded">run_upload_schedule.bat</code> を実行
        </span>
      </section>

      {/* QR */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-6">
        <div>
          <h2 className="text-sm font-bold text-gray-700 mb-1">写真投稿用QRコード</h2>
          <p className="text-xs text-gray-500 mb-2">スマホで読み取って、レシート写真を投稿できます</p>
          <p className="text-xs text-blue-600 break-all">{submitUrl}</p>
        </div>
        {qrSrc && <img src={qrSrc} alt="QR" className="w-32 h-32 ml-auto" />}
      </section>

      {/* 経費項目管理 */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowItemMgmt(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          <span>経費項目マスタ（{items.length}件）</span>
          <span className="text-gray-400 text-xs">{showItemMgmt ? '▲ 閉じる' : '▼ 開く'}</span>
        </button>
        {showItemMgmt && (
          <div className="border-t border-gray-100 p-4 space-y-4">
            {/* 追加フォーム */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">新規追加</p>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                  placeholder="コード（例: 601）"
                  className="px-2 py-1.5 border rounded text-xs w-32"
                />
                <input
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder="カテゴリ（例: 直接費・原価）"
                  className="px-2 py-1.5 border rounded text-xs w-44"
                />
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="名称（例: 業務雑費）"
                  className="px-2 py-1.5 border rounded text-xs flex-1 min-w-[140px]"
                />
                <button
                  onClick={addItem}
                  disabled={itemSaving}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                >
                  {itemSaving ? '追加中...' : '追加'}
                </button>
              </div>
              {itemError && <p className="text-xs text-red-600">{itemError}</p>}
            </div>

            {/* 一覧 */}
            {items.length === 0 ? (
              <p className="text-xs text-gray-400">経費項目がありません。上のフォームから追加してください。</p>
            ) : (
              <div className="border rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left w-20">コード</th>
                      <th className="px-3 py-2 text-left">カテゴリ</th>
                      <th className="px-3 py-2 text-left">名称</th>
                      <th className="px-3 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.code} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 font-mono">{item.code}</td>
                        <td className="px-3 py-1.5 text-gray-500">{item.category || '-'}</td>
                        <td className="px-3 py-1.5">{item.name}</td>
                        <td className="px-3 py-1.5 text-right">
                          <button onClick={() => deleteItem(item.code)} className="text-red-500 hover:text-red-700">削除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* フィルタ */}
      <section className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-gray-600">申請年月</span>
          <input type="month" value={applyFilter} onChange={e => setApplyFilter(e.target.value)} className="px-2 py-1 border rounded" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-600">PJ</span>
          <select value={pjFilter} onChange={e => setPjFilter(e.target.value)} className="px-2 py-1 border rounded min-w-[200px]">
            <option value="">すべて</option>
            {projects.map(p => <option key={p.pj_no} value={p.pj_no}>{p.pj_no} {p.case_name}</option>)}
          </select>
        </label>
        <div className="ml-auto text-xs text-gray-500">
          合計 ¥{totalAmount.toLocaleString()} / {expenses.length}件
        </div>
      </section>

      {/* テーブル */}
      <section>
        {loading ? (
          <p className="text-gray-400 text-sm">読み込み中...</p>
        ) : error ? (
          <p className="text-red-600 text-sm">{error}</p>
        ) : expenses.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-400">
            該当する経費がありません
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left">利用日</th>
                  <th className="px-2 py-2 text-left">取引先</th>
                  <th className="px-2 py-2 text-left">PJ</th>
                  <th className="px-2 py-2 text-left">経費項目</th>
                  <th className="px-2 py-2 text-right">金額</th>
                  <th className="px-2 py-2 text-center">状態</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-2 py-2">{e.usage_date || '-'}</td>
                    <td className="px-2 py-2">{e.vendor_name || '-'}</td>
                    <td className="px-2 py-2">{e.pj_no || '-'}</td>
                    <td className="px-2 py-2">{e.expense_item || '-'}</td>
                    <td className="px-2 py-2 text-right">¥{(e.total_amount ?? 0).toLocaleString()}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${e.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {e.status === 'confirmed' ? '確定' : '未確定'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => setEditing(e)} className="text-blue-600 hover:underline mr-2">編集</button>
                      <button onClick={() => deleteExpense(e.id)} className="text-red-500 hover:underline">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 編集モーダル */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-gray-800">経費を編集</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">申請年月</span>
                <input type="month" value={editing.apply_month || ''} onChange={e => setEditing({ ...editing, apply_month: e.target.value })} className="w-full px-2 py-1 border rounded" />
              </label>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">利用日</span>
                <input type="date" value={editing.usage_date || ''} onChange={e => setEditing({ ...editing, usage_date: e.target.value })} className="w-full px-2 py-1 border rounded" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">PJ</span>
                <select value={editing.pj_no || ''} onChange={e => {
                  const p = projects.find(pp => pp.pj_no === e.target.value)
                  setEditing({ ...editing, pj_no: e.target.value || null, pj_name: p?.case_name || null })
                }} className="w-full px-2 py-1 border rounded">
                  <option value="">未選択</option>
                  {projects.map(p => <option key={p.pj_no} value={p.pj_no}>{p.pj_no} {p.case_name}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">経費項目</span>
                <select value={editing.expense_item_code || ''} onChange={e => {
                  const it = items.find(i => i.code === e.target.value)
                  setEditing({ ...editing, expense_item_code: e.target.value || null, expense_item: it?.name || null })
                }} className="w-full px-2 py-1 border rounded">
                  <option value="">未選択</option>
                  {items.map(i => <option key={i.code} value={i.code}>{i.code} {i.name}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">所属部署</span>
                <select value={editing.department_code || ''} onChange={e => setEditing({ ...editing, department_code: e.target.value || null })} className="w-full px-2 py-1 border rounded">
                  <option value="">未選択</option>
                  {depts.map(d => <option key={d.code} value={d.code}>{d.code} {d.name}</option>)}
                </select>
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">取引先</span>
                <input value={editing.vendor_name || ''} onChange={e => setEditing({ ...editing, vendor_name: e.target.value })} className="w-full px-2 py-1 border rounded" />
              </label>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">金額</span>
                <input type="number" value={editing.total_amount ?? ''} onChange={e => setEditing({ ...editing, total_amount: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-2 py-1 border rounded" />
              </label>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">状態</span>
                <select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as 'pending' | 'confirmed' })} className="w-full px-2 py-1 border rounded">
                  <option value="pending">未確定</option>
                  <option value="confirmed">確定</option>
                </select>
              </label>
            </div>
            <div className="text-[10px] text-gray-400">
              ファイル: {editing.source_file || '-'}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">キャンセル</button>
              <button onClick={async () => {
                await updateExpense(editing.id, {
                  apply_month: editing.apply_month,
                  usage_date: editing.usage_date,
                  pj_no: editing.pj_no,
                  pj_name: editing.pj_name,
                  expense_item: editing.expense_item,
                  expense_item_code: editing.expense_item_code,
                  vendor_name: editing.vendor_name,
                  total_amount: editing.total_amount,
                  department_code: editing.department_code,
                  status: editing.status,
                })
                setEditing(null)
              }} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* スケジュールモーダル */}
      {showSchedule && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="font-bold text-gray-800">スケジュール</h3>
                {schedule?.updated_at && (
                  <p className="text-xs text-gray-400 mt-0.5">最終取込: {schedule.updated_at.replace('T', ' ')} / {schedule.count}件</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-sm text-gray-600">
                  <span>月</span>
                  <input
                    type="month"
                    value={scheduleFilter}
                    onChange={e => setScheduleFilter(e.target.value)}
                    className="px-2 py-1 border rounded text-sm"
                  />
                </label>
                <button onClick={() => setShowSchedule(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
              </div>
            </div>

            {/* 本文 */}
            <div className="overflow-y-auto flex-1 p-4">
              {scheduleLoading ? (
                <p className="text-gray-400 text-sm text-center py-12">読み込み中...</p>
              ) : !schedule?.exists ? (
                <div className="text-center py-12 text-sm text-gray-400 space-y-2">
                  <p>データがありません。</p>
                  <p className="text-xs"><code className="bg-gray-100 px-1 rounded">run_upload_schedule.bat</code> を実行してください。</p>
                </div>
              ) : (() => {
                const filtered = (schedule.records || []).filter(r => {
                  if (!scheduleFilter) return true
                  const [fy, fm] = scheduleFilter.split('-')
                  return r.年 === fy && r.月 === fm.replace(/^0/, '')
                })
                return filtered.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-12">該当するデータがありません</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left w-24">日付</th>
                        <th className="px-2 py-2 text-left w-24">時間</th>
                        <th className="px-2 py-2 text-left">得意先名</th>
                        <th className="px-2 py-2 text-left">PJコード</th>
                        <th className="px-2 py-2 text-left">件名</th>
                        <th className="px-2 py-2 text-left w-20">稼働区分</th>
                        <th className="px-2 py-2 text-right w-20">稼働費</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r, i) => (
                        <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-2 py-1.5">{r.date}</td>
                          <td className="px-2 py-1.5 text-gray-500">
                            {r.時間STR !== '0' && r.時間END !== '0' ? `${r.時間STR}:00〜${r.時間END}:00` : '-'}
                          </td>
                          <td className="px-2 py-1.5">{r.得意先名}</td>
                          <td className="px-2 py-1.5 font-mono text-gray-500">{r.PJコード || '-'}</td>
                          <td className="px-2 py-1.5">{r.件名 || r.備考 || '-'}</td>
                          <td className="px-2 py-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              r.稼働区分 === '講師稼働' ? 'bg-blue-100 text-blue-700' :
                              r.稼働区分 === '作命' ? 'bg-purple-100 text-purple-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>{r.稼働区分 || '-'}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {r.稼働費 ? `¥${Number(r.稼働費).toLocaleString()}` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              })()}
            </div>

            {/* フッター */}
            <div className="px-5 py-3 border-t text-xs text-gray-400 flex items-center justify-between">
              <span>データ更新は <code className="bg-gray-100 px-1 rounded">run_upload_schedule.bat</code> を実行後、再度このボタンを押してください</span>
              <button onClick={loadSchedule} disabled={scheduleLoading} className="text-indigo-600 hover:underline disabled:opacity-40">再読み込み</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
