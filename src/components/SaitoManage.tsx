'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import QRCode from 'qrcode'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import type { ReceiptSaito, Project, ExpenseItem, Department, TaxCategory } from '@/types'
import { CATEGORIES } from '@/lib/category'
import { buildSaitoFilename } from '@/lib/filename'

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

function shiftMonth(value: string, delta: number): string {
  const [y, m] = value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={() => onChange(shiftMonth(value, -1))}
        className="px-2 py-1 border rounded hover:bg-gray-50 text-gray-600"
        aria-label="前月"
      >▲</button>
      <span className="px-2 py-1 font-mono min-w-[80px] text-center text-sm">{value}</span>
      <button
        onClick={() => onChange(shiftMonth(value, 1))}
        className="px-2 py-1 border rounded hover:bg-gray-50 text-gray-600"
        aria-label="翌月"
      >▼</button>
    </div>
  )
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
  const [prediction, setPrediction] = useState<{
    pj_no: string | null
    pj_name: string | null
    client_name: string | null
    expense_item_code: string | null
    department_code: string | null
    category: string | null
    notes: string | null
    source: 'schedule' | 'history' | 'both' | 'none'
    confidence: number
    candidates: {
      schedule: { pj_no: string; client_name: string; subject: string }[]
      history: { pj_no: string | null; expense_item_code: string | null; count: number }[]
    }
  } | null>(null)
  const [predicting, setPredicting] = useState(false)

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
  const [showQr, setShowQr] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [itemSaving, setItemSaving] = useState(false)
  const [itemError, setItemError] = useState('')

  // 編集モーダルの画像トリミング
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string>('')
  const [crop, setCrop] = useState<Crop>({ unit: '%', x: 5, y: 5, width: 90, height: 90 })
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null)
  const [savingFile, setSavingFile] = useState(false)
  const [savingExpense, setSavingExpense] = useState(false)
  const cropImgRef = useRef<HTMLImageElement | null>(null)

  // PCからのアップロード（state/refのみ。実装はload定義後）
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; errors: string[] }>({ done: 0, total: 0, errors: [] })
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

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

  // スケジュールを初回マウント時にロード（PJフィルタの候補生成用）
  useEffect(() => {
    if (schedule === null) loadSchedule()
  }, [schedule, loadSchedule])

  // 編集モーダルのPJ dropdown用: 申請年月スケジュールの日付別エントリ
  // - 件名が「移動・前日入り」のものは除外
  // - 日付昇順
  const scheduleEntriesForEdit = useMemo(() => {
    if (!schedule?.records || !applyFilter) return [] as { key: string; date: string; pj_no: string; client_name: string; subject: string }[]
    const [fy, fm] = applyFilter.split('-')
    const fyNum = parseInt(fy, 10)
    const fmNum = parseInt(fm, 10)
    const list: { key: string; date: string; pj_no: string; client_name: string; subject: string }[] = []
    for (const r of schedule.records) {
      if (!r.PJコード) continue
      if (parseInt(r.年 || '0', 10) !== fyNum || parseInt(r.月 || '0', 10) !== fmNum) continue
      const subject = r.件名 || ''
      if (subject === '移動・前日入り') continue
      list.push({
        key: `${r.date}_${r.PJコード}_${subject}`,
        date: r.date || '',
        pj_no: r.PJコード,
        client_name: r.得意先名 || '',
        subject,
      })
    }
    return list.sort((a, b) => a.date.localeCompare(b.date))
  }, [schedule, applyFilter])

  // 申請年月のスケジュールに含まれるPJ番号一覧（フィルタdropdown用）
  const pjOptionsForFilter = useMemo(() => {
    if (!schedule?.records || !applyFilter) return [] as { pj_no: string; case_name: string; client_name: string }[]
    const [fy, fm] = applyFilter.split('-')
    const fyNum = parseInt(fy, 10)
    const fmNum = parseInt(fm, 10)
    const map = new Map<string, { pj_no: string; case_name: string; client_name: string }>()
    for (const r of schedule.records) {
      if (!r.PJコード) continue
      // 月は '04' / '4' どちらでも一致するよう数値比較
      if (parseInt(r.年 || '0', 10) !== fyNum || parseInt(r.月 || '0', 10) !== fmNum) continue
      if (!map.has(r.PJコード)) {
        map.set(r.PJコード, {
          pj_no: r.PJコード,
          case_name: r.件名 || '',
          client_name: r.得意先名 || '',
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.pj_no.localeCompare(b.pj_no))
  }, [schedule, applyFilter])

  const orientImage = async (f: File): Promise<File> => {
    if (!f.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return f
    try {
      const bitmap = await createImageBitmap(f, { imageOrientation: 'from-image' })
      const c = document.createElement('canvas')
      c.width = bitmap.width; c.height = bitmap.height
      c.getContext('2d')!.drawImage(bitmap, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) =>
        c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92))
      return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
    } catch { return f }
  }

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    )
    if (list.length === 0) return
    setUploading(true)
    setUploadProgress({ done: 0, total: list.length, errors: [] })
    const errors: string[] = []
    for (const f of list) {
      try {
        const oriented = await orientImage(f)
        const fd = new FormData()
        fd.append('file', oriented)
        fd.append('apply_month', applyFilter || getCurrentApplyMonth())
        const res = await fetch('/api/expenses/submit', { method: 'POST', body: fd })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          errors.push(`${f.name}: ${d.error || res.status}`)
        }
      } catch (e) {
        errors.push(`${f.name}: ${e instanceof Error ? e.message : 'failed'}`)
      }
      setUploadProgress(p => ({ ...p, done: p.done + 1, errors }))
    }
    setUploading(false)
    if (uploadInputRef.current) uploadInputRef.current.value = ''
    await load()
  }, [applyFilter, load])

  // 編集モーダル開いたら予測APIを呼んで未入力項目に自動適用
  useEffect(() => {
    if (!editing) { setPrediction(null); return }
    const vendor = editing.vendor_name || ''
    const usage = editing.usage_date || ''
    if (!vendor && !usage) { setPrediction(null); return }
    const editingId = editing.id
    setPredicting(true)
    const params = new URLSearchParams()
    if (vendor) params.set('vendor_name', vendor)
    if (usage) params.set('usage_date', usage)
    if (editing.pj_no) params.set('pj_no', editing.pj_no)
    if (editing.client_name) params.set('client_name', editing.client_name)
    if (editing.tax_rate != null) params.set('tax_rate', String(editing.tax_rate))
    fetch(`/api/expenses/predict?${params}`)
      .then(r => r.json())
      .then(data => {
        if (!data || !data.source || data.source === 'none') { setPrediction(null); return }
        setPrediction(data)
        // schedule系（日付駆動）は常に上書き、history系（vendor駆動）は空欄のみ
        const fromSchedule = data.source === 'schedule' || data.source === 'both'
        setEditing(prev => {
          if (!prev || prev.id !== editingId) return prev
          const next = { ...prev }
          if (data.pj_no && (fromSchedule || !next.pj_no)) {
            const p = projectsAugmented.find(pp => pp.pj_no === data.pj_no)
            next.pj_no = data.pj_no
            next.pj_name = p?.case_name || data.pj_name || null
          }
          if (data.client_name && (fromSchedule || !next.client_name)) {
            next.client_name = data.client_name
          }
          if (!next.expense_item_code && data.expense_item_code) {
            const it = itemsAugmented.find(i => i.code === data.expense_item_code)
            next.expense_item_code = data.expense_item_code
            next.expense_item = it?.name || null
          }
          if (!next.department_code && data.department_code) {
            next.department_code = data.department_code
          }
          if (!next.category && data.category) {
            next.category = data.category
          }
          // notesは伝票ごとに固有なので自動反映しない
          return next
        })
      })
      .catch(() => setPrediction(null))
      .finally(() => setPredicting(false))
  }, [editing?.id, editing?.vendor_name, editing?.usage_date, projects, items])

  // 画像URL（編集対象用）
  const editImageUrl = useMemo(
    () => editing?.source_file_id ? `/api/expenses/${editing.id}/file?ts=${Date.parse(editing.updated_at || '') || 0}` : '',
    [editing?.id, editing?.source_file_id, editing?.updated_at]
  )

  const startCrop = useCallback(() => {
    if (!editImageUrl) return
    setCropImageSrc(editImageUrl)
    setCrop({ unit: '%', x: 5, y: 5, width: 90, height: 90 })
    setCompletedCrop(null)
    setShowCropper(true)
  }, [editImageUrl])

  const saveCroppedImage = async () => {
    if (!editing || !completedCrop || !cropImgRef.current) return
    setSavingFile(true)
    try {
      const img = cropImgRef.current
      // 表示サイズ→自然サイズへの変換
      const scaleX = img.naturalWidth / img.width
      const scaleY = img.naturalHeight / img.height
      const sx = completedCrop.x * scaleX
      const sy = completedCrop.y * scaleY
      const sw = completedCrop.width * scaleX
      const sh = completedCrop.height * scaleY
      const c = document.createElement('canvas')
      c.width = sw
      c.height = sh
      c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const blob = await new Promise<Blob>((resolve, reject) =>
        c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
      )
      const fd = new FormData()
      fd.append('file', new File([blob], 'cropped.jpg', { type: 'image/jpeg' }))
      const res = await fetch(`/api/expenses/${editing.id}/file`, { method: 'PUT', body: fd })
      if (!res.ok) throw new Error('差し替え失敗')
      const updated = await res.json()
      // 一覧の該当エントリは差し替え結果で更新
      setExpenses(prev => prev.map(e => e.id === updated.id ? updated : e))
      // 編集中のフォーム値（保存前）は保持し、ファイル関連だけ反映
      setEditing(prev => prev ? {
        ...prev,
        source_file_id: updated.source_file_id,
        source_file: updated.source_file,
        updated_at: updated.updated_at,
      } : null)
      setShowCropper(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'トリミング失敗')
    } finally {
      setSavingFile(false)
    }
  }

  const applyPrediction = () => {
    if (!editing || !prediction) return
    const next = { ...editing }
    if (prediction.pj_no) {
      next.pj_no = prediction.pj_no
      // schedule由来の件名を優先（PJ dropdownのkey照合のため）
      next.pj_name = prediction.pj_name
        || projectsAugmented.find(pp => pp.pj_no === prediction.pj_no)?.case_name
        || null
    }
    if (prediction.client_name) next.client_name = prediction.client_name
    if (prediction.expense_item_code) {
      const it = itemsAugmented.find(i => i.code === prediction.expense_item_code)
      next.expense_item_code = prediction.expense_item_code
      next.expense_item = it?.name || null
    }
    if (prediction.department_code) next.department_code = prediction.department_code
    if (prediction.category) next.category = prediction.category
    if (prediction.notes) next.notes = prediction.notes
    setEditing(next)
  }

  // QRコード生成（submit URL）
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/submit`
    setSubmitUrl(url)
    QRCode.toDataURL(url, { width: 200, margin: 2 }).then(setQrSrc).catch(() => setQrSrc(''))
  }, [])

  const totalAmount = useMemo(() => expenses.reduce((s, e) => s + (e.total_amount ?? 0), 0), [expenses])

  // 利用日の古い順にソート（null/undefinedは最後）
  const expensesSorted = useMemo(() => {
    return [...expenses].sort((a, b) => {
      const ad = a.usage_date || ''
      const bd = b.usage_date || ''
      if (!ad && !bd) return 0
      if (!ad) return 1
      if (!bd) return -1
      return ad.localeCompare(bd)
    })
  }, [expenses])

  // PJ一覧: マスタ（予算書）に履歴から見つかったものを追加
  const projectsAugmented = useMemo(() => {
    const map = new Map<string, Project>()
    for (const p of projects) map.set(p.pj_no, p)
    for (const e of expenses) {
      if (e.pj_no && !map.has(e.pj_no)) {
        map.set(e.pj_no, {
          pj_no: e.pj_no,
          client_name: '',
          case_name: e.pj_name || '(履歴)',
          display_name: `${e.pj_no} ${e.pj_name || '(履歴)'}`,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.pj_no.localeCompare(a.pj_no))
  }, [projects, expenses])

  // 経費項目一覧: マスタに履歴から見つかったものを追加
  const itemsAugmented = useMemo(() => {
    const map = new Map<string, ExpenseItem>()
    for (const i of items) map.set(i.code, i)
    for (const e of expenses) {
      if (e.expense_item_code && !map.has(e.expense_item_code)) {
        map.set(e.expense_item_code, {
          code: e.expense_item_code,
          name: e.expense_item || '(履歴)',
          category: '履歴',
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  }, [items, expenses])

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

      {/* QR（折りたたみ） */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowQr(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          <span>📱 写真投稿用QRコード</span>
          <span className="text-gray-400 text-xs">{showQr ? '▲ 閉じる' : '▼ 開く'}</span>
        </button>
        {showQr && (
          <div className="border-t border-gray-100 p-5 flex items-center gap-6">
            <div>
              <p className="text-xs text-gray-500 mb-2">スマホで読み取って、レシート写真を投稿できます</p>
              <p className="text-xs text-blue-600 break-all">{submitUrl}</p>
            </div>
            {qrSrc && <img src={qrSrc} alt="QR" className="w-32 h-32 ml-auto" />}
          </div>
        )}
      </section>

      {/* PCアップロード */}
      <section
        className={`bg-white border-2 ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-dashed border-gray-300'} rounded-xl p-5 transition-colors`}
        onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files)
        }}
      >
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={e => { if (e.target.files) uploadFiles(e.target.files) }}
          className="hidden"
        />
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-gray-600">
            <div className="font-medium text-gray-700 mb-0.5">📎 ファイル / 画像をアップロード</div>
            <div className="text-xs text-gray-500">複数同時OK・PDF/JPEG/PNG対応・申請年月は上のフィルタ値を使用</div>
          </div>
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {uploading ? `処理中 ${uploadProgress.done}/${uploadProgress.total}` : 'ファイル選択'}
          </button>
        </div>
        {uploading && (
          <div className="mt-3 bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all"
              style={{ width: uploadProgress.total > 0 ? `${(uploadProgress.done / uploadProgress.total) * 100}%` : '0%' }}
            />
          </div>
        )}
        {!uploading && uploadProgress.errors.length > 0 && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 space-y-0.5">
            <div className="font-medium">失敗したファイル ({uploadProgress.errors.length}件):</div>
            {uploadProgress.errors.map((er, i) => <div key={i}>• {er}</div>)}
          </div>
        )}
        {!uploading && uploadProgress.total > 0 && uploadProgress.errors.length === 0 && (
          <div className="mt-2 text-xs text-green-600">✓ {uploadProgress.total}件アップロード完了</div>
        )}
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
          <MonthStepper value={applyFilter} onChange={setApplyFilter} />
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
                  <th className="px-2 py-2 text-left">企業先名</th>
                  <th className="px-2 py-2 text-left">分類</th>
                  <th className="px-2 py-2 text-right">金額</th>
                  <th className="px-2 py-2 text-center">状態</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {expensesSorted.map(e => (
                  <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-2 py-2">{e.usage_date || '-'}</td>
                    <td className="px-2 py-2">{e.vendor_name || '-'}</td>
                    <td className="px-2 py-2">{e.client_name || '-'}</td>
                    <td className="px-2 py-2">{e.category || '-'}</td>
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
          <div className="bg-white rounded-xl max-w-3xl w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-gray-800">経費を編集</h3>

            {/* サムネイル＋トリミングUI */}
            {editing.source_file_id && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                {!showCropper ? (
                  <div className="flex gap-3 items-start">
                    <a href={editImageUrl} target="_blank" rel="noopener noreferrer" className="block flex-shrink-0">
                      <img
                        src={editImageUrl}
                        alt="receipt"
                        className="w-40 h-40 object-contain bg-white border border-gray-200 rounded"
                      />
                    </a>
                    <div className="text-xs text-gray-500 space-y-1 flex-1">
                      <div>ファイル: <code className="bg-white px-1">{editing.source_file}</code></div>
                      <button
                        type="button"
                        onClick={startCrop}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700"
                      >✂ 余白を再トリミング</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">枠の四隅・辺をドラッグしてトリミング範囲を調整してください</p>
                    <div className="bg-gray-900 rounded p-2 flex items-center justify-center" style={{ maxHeight: '70vh', overflow: 'auto' }}>
                      <ReactCrop
                        crop={crop}
                        onChange={c => setCrop(c)}
                        onComplete={c => setCompletedCrop(c)}
                        keepSelection
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          ref={cropImgRef}
                          src={cropImageSrc}
                          alt="トリミング対象"
                          style={{ maxHeight: '65vh', display: 'block' }}
                          onLoad={e => {
                            const i = e.currentTarget
                            // 初期 crop = 画像全体
                            setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 })
                            setCompletedCrop({ unit: 'px', x: 0, y: 0, width: i.width, height: i.height })
                          }}
                        />
                      </ReactCrop>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowCropper(false)} className="px-3 py-1 text-xs text-gray-600 hover:text-gray-900">キャンセル</button>
                      <button
                        onClick={saveCroppedImage}
                        disabled={savingFile || !completedCrop}
                        className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-40"
                      >{savingFile ? '保存中...' : '✓ Driveに保存'}</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 予測パネル */}
            {predicting && (
              <div className="bg-blue-50 text-blue-700 text-xs px-3 py-2 rounded">予測中...</div>
            )}
            {prediction && prediction.source !== 'none' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-amber-800">
                    🔮 予測（信頼度 {Math.round(prediction.confidence * 100)}% / {
                      prediction.source === 'both' ? 'スケジュール＋履歴' :
                      prediction.source === 'schedule' ? 'スケジュール' : '履歴'
                    }）
                  </span>
                  <button onClick={applyPrediction}
                    className="px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 text-[11px]">
                    適用
                  </button>
                </div>
                {prediction.pj_no && (
                  <div className="text-gray-700">
                    PJ: <span className="font-mono">{prediction.pj_no}</span>
                    {(() => {
                      const p = projectsAugmented.find(pp => pp.pj_no === prediction.pj_no)
                      return p ? <span className="text-gray-500"> {p.case_name}</span> : null
                    })()}
                  </div>
                )}
                {prediction.expense_item_code && (
                  <div className="text-gray-700">
                    経費項目: <span className="font-mono">{prediction.expense_item_code}</span>
                    {(() => {
                      const it = itemsAugmented.find(i => i.code === prediction.expense_item_code)
                      return it ? <span className="text-gray-500"> {it.name}</span> : null
                    })()}
                  </div>
                )}
                {prediction.candidates.schedule.length > 1 && (
                  <details className="text-gray-500" open>
                    <summary className="cursor-pointer">同日他のスケジュール候補（{prediction.candidates.schedule.length}件・クリックで適用）</summary>
                    <ul className="pl-3 pt-1 space-y-1">
                      {prediction.candidates.schedule.slice(0, 10).map(s => {
                        const selected = editing.pj_no === s.pj_no
                        return (
                          <li key={s.pj_no}>
                            <button
                              type="button"
                              onClick={() => setEditing({
                                ...editing,
                                pj_no: s.pj_no,
                                pj_name: s.subject || null,
                                client_name: s.client_name || editing.client_name,
                              })}
                              className={`text-left px-2 py-1 rounded text-xs hover:bg-amber-100 w-full ${selected ? 'bg-amber-200 font-medium' : 'bg-white'}`}
                            >
                              <span className="font-mono">{s.pj_no}</span> {s.client_name} {s.subject && `／ ${s.subject}`}
                              {selected && <span className="ml-1 text-amber-700">✓</span>}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                )}
              </div>
            )}

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
                <span className="text-gray-600 text-xs">PJ（{applyFilter}のスケジュール／移動・前日入り除く）</span>
                <select
                  value={editing.pj_no && editing.usage_date ? `${editing.usage_date}_${editing.pj_no}_${editing.pj_name || ''}` : ''}
                  onChange={e => {
                    const v = e.target.value
                    if (!v) {
                      setEditing({ ...editing, pj_no: null, pj_name: null })
                      return
                    }
                    const sel = scheduleEntriesForEdit.find(s => s.key === v)
                    if (sel) {
                      setEditing({
                        ...editing,
                        pj_no: sel.pj_no,
                        pj_name: sel.subject || null,
                        client_name: sel.client_name || editing.client_name,
                        usage_date: sel.date || editing.usage_date,
                      })
                    }
                  }}
                  className="w-full px-2 py-1 border rounded font-mono text-xs"
                >
                  <option value="">未選択</option>
                  {scheduleEntriesForEdit.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.date} {s.pj_no} {s.client_name} {s.subject}
                    </option>
                  ))}
                </select>
                {scheduleEntriesForEdit.length === 0 && (
                  <p className="text-[11px] text-gray-400">{applyFilter}のスケジュールが見つかりません</p>
                )}
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">企業名（客先）</span>
                <input
                  value={editing.client_name || ''}
                  onChange={e => setEditing({ ...editing, client_name: e.target.value || null })}
                  placeholder="スケジュール得意先名から自動取得"
                  className="w-full px-2 py-1 border rounded"
                />
              </label>
              <div className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">分類（ファイル名用）{editing.category && <span className="ml-2 text-amber-700">選択中: {editing.category}</span>}</span>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map(c => {
                    const selected = editing.category === c
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditing({ ...editing, category: selected ? null : c })}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                          selected
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >{c}</button>
                    )
                  })}
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">経費項目（楽々精算）</span>
                <select value={editing.expense_item_code || ''} onChange={e => {
                  const it = itemsAugmented.find(i => i.code === e.target.value)
                  setEditing({ ...editing, expense_item_code: e.target.value || null, expense_item: it?.name || null })
                }} className="w-full px-2 py-1 border rounded">
                  <option value="">未選択</option>
                  {itemsAugmented.map(i => <option key={i.code} value={i.code}>{i.code} {i.name}</option>)}
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
              <label className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">登録番号（インボイスT番号）</span>
                <input
                  value={editing.invoice_no || ''}
                  onChange={e => setEditing({ ...editing, invoice_no: e.target.value || null })}
                  placeholder="T+13桁（例: T1234567890123）"
                  className="w-full px-2 py-1 border rounded font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">金額（税込）</span>
                <input type="number" value={editing.total_amount ?? ''} onChange={e => setEditing({ ...editing, total_amount: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-2 py-1 border rounded" />
              </label>
              <label className="space-y-1">
                <span className="text-gray-600 text-xs">消費税額</span>
                <input type="number" value={editing.tax_amount ?? ''} onChange={e => setEditing({ ...editing, tax_amount: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-2 py-1 border rounded" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">税区分</span>
                <select
                  value={editing.tax_category ?? ''}
                  onChange={e => {
                    const cat = (e.target.value || null) as TaxCategory
                    const rate = cat === '10' ? 0.10 : cat === '8' ? 0.08 : cat === 'free' || cat === 'out' ? 0 : null
                    setEditing({ ...editing, tax_category: cat, tax_rate: rate })
                  }}
                  className="w-full px-2 py-1 border rounded"
                >
                  <option value="">未設定</option>
                  <option value="10">標準 10%</option>
                  <option value="8">軽減 8%</option>
                  <option value="free">非課税</option>
                  <option value="out">不課税</option>
                </select>
              </label>
              <div className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">追加税種別（ファイル名末尾に付与）</span>
                <div className="flex gap-3 text-sm">
                  {['入湯税', '宿泊税'].map(label => {
                    const checked = (editing.extra_tax_labels || []).includes(label)
                    return (
                      <label key={label} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const cur = editing.extra_tax_labels || []
                            const next = e.target.checked
                              ? [...cur.filter(l => l !== label), label]
                              : cur.filter(l => l !== label)
                            setEditing({ ...editing, extra_tax_labels: next })
                          }}
                        />
                        {label}
                      </label>
                    )
                  })}
                </div>
              </div>
              <label className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">備考（同行者・用途詳細など）</span>
                <textarea
                  value={editing.notes || ''}
                  onChange={e => setEditing({ ...editing, notes: e.target.value || null })}
                  placeholder="例: 同行者 山田・佐藤 / 受講者用 / 出張先での会食"
                  rows={2}
                  className="w-full px-2 py-1 border rounded text-sm"
                />
              </label>
              <div className="col-span-2 space-y-1">
                <span className="text-gray-600 text-xs">状態</span>
                <div className="flex gap-2">
                  {([['pending', '未確定', 'bg-yellow-500'], ['confirmed', '確定', 'bg-green-600']] as const).map(([val, label, color]) => {
                    const selected = editing.status === val
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setEditing({ ...editing, status: val })}
                        className={`flex-1 px-3 py-1.5 rounded text-sm border transition-colors ${
                          selected ? `${color} text-white border-transparent` : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >{selected && '✓ '}{label}</button>
                    )
                  })}
                </div>
              </div>
            </div>
            {(() => {
              const before = editing.source_file || '-'
              const after = editing.source_file
                ? buildSaitoFilename(
                    {
                      apply_month: editing.apply_month,
                      pj_no: editing.pj_no,
                      client_name: editing.client_name,
                      category: editing.category,
                      vendor_name: editing.vendor_name,
                      usage_date: editing.usage_date,
                      extra_tax_labels: editing.extra_tax_labels || [],
                    },
                    editing.source_file,
                  )
                : '-'
              const changed = before !== after
              return (
                <div className="text-[11px] space-y-0.5 bg-gray-50 rounded p-2 font-mono">
                  <div className="text-gray-500">
                    <span className="inline-block w-12 text-gray-400">現在:</span>
                    <span className="break-all">{before}</span>
                  </div>
                  <div className={changed ? 'text-blue-700' : 'text-gray-400'}>
                    <span className="inline-block w-12 text-gray-400">保存後:</span>
                    <span className="break-all">{after}{changed && ' ←変更'}</span>
                  </div>
                </div>
              )
            })()}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">キャンセル</button>
              {(() => {
                // トリミング画面が開いていて、かつ範囲が画像全体でない場合のみ画像差し替え
                const shouldApplyCrop = (): boolean => {
                  if (!showCropper || !completedCrop || !cropImgRef.current) return false
                  const img = cropImgRef.current
                  const w = completedCrop.width
                  const h = completedCrop.height
                  // 表示サイズに対して99%以上ならトリミング不要とみなす
                  return w / img.width < 0.99 || h / img.height < 0.99
                }
                const buildPatch = (e: ReceiptSaito) => ({
                  apply_month: e.apply_month,
                  usage_date: e.usage_date,
                  pj_no: e.pj_no,
                  pj_name: e.pj_name,
                  client_name: e.client_name,
                  category: e.category,
                  expense_item: e.expense_item,
                  expense_item_code: e.expense_item_code,
                  vendor_name: e.vendor_name,
                  invoice_no: e.invoice_no,
                  total_amount: e.total_amount,
                  tax_amount: e.tax_amount,
                  tax_rate: e.tax_rate,
                  tax_category: e.tax_category,
                  extra_tax_labels: e.extra_tax_labels || [],
                  department_code: e.department_code,
                  notes: e.notes,
                  status: e.status,
                })
                return (
                  <>
                    <button
                      disabled={savingExpense || savingFile}
                      onClick={async () => {
                        setSavingExpense(true)
                        try {
                          if (shouldApplyCrop()) await saveCroppedImage()
                          await updateExpense(editing.id, buildPatch(editing))
                          const idx = expensesSorted.findIndex(x => x.id === editing.id)
                          const after = expensesSorted.slice(idx + 1).find(x => x.status === 'pending')
                          const before = expensesSorted.slice(0, idx).find(x => x.status === 'pending')
                          const next = after || before || null
                          if (next) setEditing(next)
                          else setEditing(null)
                        } finally {
                          setSavingExpense(false)
                        }
                      }}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-60"
                    >{savingExpense ? '保存中...' : '保存して次'}</button>
                    <button
                      disabled={savingExpense || savingFile}
                      onClick={async () => {
                        setSavingExpense(true)
                        try {
                          if (shouldApplyCrop()) await saveCroppedImage()
                          await updateExpense(editing.id, buildPatch(editing))
                          setEditing(null)
                        } finally {
                          setSavingExpense(false)
                        }
                      }}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60"
                    >{savingExpense ? '保存中...' : '保存して閉じる'}</button>
                  </>
                )
              })()}
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
                <MonthStepper value={scheduleFilter} onChange={setScheduleFilter} />
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
                  return r.年 === fy && parseInt(r.月, 10) === parseInt(fm, 10)
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
