'use client'

import { useEffect, useState, useRef } from 'react'
import type { Project, ExpenseItem, Department } from '@/types'

function getCurrentApplyMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// カテゴリ別にグループ化
function groupByCategory(items: ExpenseItem[]): { category: string; items: ExpenseItem[] }[] {
  const map = new Map<string, ExpenseItem[]>()
  for (const item of items) {
    const cat = item.category || 'その他'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(item)
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
}

export default function SaitoSubmit() {
  const [projects, setProjects] = useState<Project[]>([])
  const [items, setItems] = useState<ExpenseItem[]>([])
  const [depts, setDepts] = useState<Department[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [applyMonth, setApplyMonth] = useState(getCurrentApplyMonth())
  const [pjNo, setPjNo] = useState('')
  const [expenseCode, setExpenseCode] = useState('')
  const [deptCode, setDeptCode] = useState('5101')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/expense-items').then(r => r.json()),
      fetch('/api/departments').then(r => r.json()),
    ]).then(([p, i, d]) => {
      setProjects(p.projects || [])
      setItems(i.items || [])
      setDepts(d.departments || [])
    })
  }, [])

  const handleFile = (f: File | null) => {
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
    setSuccess(false)
  }

  const submit = async () => {
    if (!file) return setError('ファイルを選択してください')
    if (!pjNo) return setError('PJを選択してください')
    if (!expenseCode) return setError('経費項目を選択してください')
    setSubmitting(true); setError(''); setSuccess(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('apply_month', applyMonth)
      fd.append('pj_no', pjNo)
      const p = projects.find(pp => pp.pj_no === pjNo)
      if (p) fd.append('pj_name', p.case_name)
      fd.append('expense_item_code', expenseCode)
      const it = items.find(i => i.code === expenseCode)
      if (it) fd.append('expense_item', it.name)
      if (deptCode) fd.append('department_code', deptCode)

      const res = await fetch('/api/expenses/submit', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '送信に失敗しました')
      setSuccess(true)
      setFile(null)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const grouped = groupByCategory(items)
  const selectedItem = items.find(i => i.code === expenseCode)
  const selectedProject = projects.find(p => p.pj_no === pjNo)

  const isReady = !!file && !!pjNo && !!expenseCode

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto p-4 pb-32 space-y-4">
        <h1 className="text-lg font-bold text-gray-800 pt-2">経費申請</h1>

        {/* 成功メッセージ */}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
            <span className="text-green-500 mt-0.5">✓</span>
            <div>
              <div className="font-medium">送信しました</div>
              <div className="text-xs text-green-600 mt-0.5">続けて別の経費を申請できます</div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* ① 申請年月 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">申請年月</label>
          <input
            type="month"
            value={applyMonth}
            onChange={e => setApplyMonth(e.target.value)}
            className="w-full text-base border-0 focus:ring-0 p-0 text-gray-800 font-medium"
          />
        </div>

        {/* ② 所属部署 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">所属部署</label>
          <select
            value={deptCode}
            onChange={e => setDeptCode(e.target.value)}
            className="w-full text-sm border-0 focus:ring-0 p-0 text-gray-800 bg-transparent"
          >
            {depts.map(d => <option key={d.code} value={d.code}>{d.code} {d.name}</option>)}
          </select>
        </div>

        {/* ③ PJ選択 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            PJ <span className="text-red-400">*</span>
          </label>
          <select
            value={pjNo}
            onChange={e => setPjNo(e.target.value)}
            className="w-full text-sm border-0 focus:ring-0 p-0 text-gray-800 bg-transparent"
          >
            <option value="">選択してください</option>
            {projects.map(p => <option key={p.pj_no} value={p.pj_no}>{p.pj_no} {p.case_name}</option>)}
          </select>
          {selectedProject && (
            <p className="text-xs text-blue-600 mt-1">{selectedProject.client_name}</p>
          )}
        </div>

        {/* ④ 経費項目 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            経費項目 <span className="text-red-400">*</span>
          </label>
          <select
            value={expenseCode}
            onChange={e => setExpenseCode(e.target.value)}
            className="w-full text-sm border-0 focus:ring-0 p-0 text-gray-800 bg-transparent"
          >
            <option value="">選択してください</option>
            {grouped.map(g => (
              <optgroup key={g.category} label={g.category}>
                {g.items.map(i => (
                  <option key={i.code} value={i.code}>{i.code} {i.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedItem?.category && (
            <p className="text-xs text-gray-400 mt-1">{selectedItem.category}</p>
          )}
        </div>

        {/* ⑤ レシート */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            レシート / 領収書 <span className="text-red-400">*</span>
          </label>

          {!file ? (
            <div className="space-y-2">
              {/* カメラ起動ボタン */}
              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.setAttribute('capture', 'environment')
                    fileInputRef.current.click()
                  }
                }}
                className="w-full py-4 border-2 border-dashed border-blue-300 rounded-xl text-blue-600 text-sm font-medium hover:bg-blue-50 flex items-center justify-center gap-2"
              >
                <span className="text-xl">📷</span> カメラで撮影
              </button>
              {/* ファイル選択 */}
              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.removeAttribute('capture')
                    fileInputRef.current.click()
                  }
                }}
                className="w-full py-2.5 border border-gray-200 rounded-xl text-gray-500 text-sm hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                <span>📁</span> ファイルを選択
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={e => handleFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-2">
              {file.type.startsWith('image/') && preview ? (
                <img src={preview} alt="preview" className="w-full max-h-64 object-contain rounded-lg bg-gray-50" />
              ) : (
                <div className="bg-gray-100 px-3 py-3 rounded-lg text-sm text-gray-600 flex items-center gap-2">
                  <span>📄</span> {file.name}
                </div>
              )}
              <button
                type="button"
                onClick={() => handleFile(null)}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                × 選択し直す
              </button>
              <p className="text-[11px] text-gray-400">取引先・利用日・金額は写真から自動取得されます</p>
            </div>
          )}
        </div>
      </div>

      {/* 送信ボタン（固定フッター） */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 max-w-lg mx-auto">
        <button
          onClick={submit}
          disabled={!isReady || submitting}
          className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-base hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? '送信中...' : isReady ? '送信する' : '必須項目を入力してください'}
        </button>
      </div>
    </div>
  )
}
