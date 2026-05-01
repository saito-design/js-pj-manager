'use client'

import { useState, useRef, useEffect } from 'react'

type CropArea = { x: number; y: number; width: number; height: number }

function getCurrentApplyMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(value: string, delta: number): string {
  const [y, m] = value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={value ? 'text-gray-800 font-medium text-right break-all' : 'text-gray-300'}>
        {value || '読み取れず'}
      </span>
    </div>
  )
}

// EXIF orientation を尊重した画像読み込み（モバイル縦撮影が横にならないように）
async function loadImage(file: File): Promise<{ width: number; height: number; source: CanvasImageSource }> {
  // モダンブラウザ: createImageBitmap で imageOrientation を尊重
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { width: bitmap.width, height: bitmap.height, source: bitmap }
    } catch {
      // フォールバック
    }
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = URL.createObjectURL(file)
  })
  return { width: img.naturalWidth, height: img.naturalHeight, source: img }
}

// 背景色（四隅サンプル平均）と異なるピクセルの bbox を検出
function detectContentBox(imgData: ImageData, threshold = 60, padding = 8): { x: number; y: number; w: number; h: number } | null {
  const { data, width, height } = imgData
  const sample = 30
  let br = 0, bg = 0, bb = 0, n = 0
  const corners: [number, number][] = [
    [0, 0], [width - sample, 0], [0, height - sample], [width - sample, height - sample],
  ]
  for (const [cx, cy] of corners) {
    for (let dy = 0; dy < sample; dy++) {
      for (let dx = 0; dx < sample; dx++) {
        const i = ((cy + dy) * width + (cx + dx)) * 4
        br += data[i]; bg += data[i + 1]; bb += data[i + 2]; n++
      }
    }
  }
  br /= n; bg /= n; bb /= n
  let minX = width, maxX = 0, minY = height, maxY = 0, found = false
  // ステップサンプリングで高速化（精度は若干粗くても十分）
  const step = Math.max(1, Math.floor(Math.min(width, height) / 800))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      if (Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb) > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        found = true
      }
    }
  }
  if (!found) return null
  minX = Math.max(0, minX - padding)
  minY = Math.max(0, minY - padding)
  maxX = Math.min(width - 1, maxX + padding)
  maxY = Math.min(height - 1, maxY + padding)
  // 検出結果が画像の半分未満ならノイズと判定して採用しない
  const w = maxX - minX + 1, h = maxY - minY + 1
  if (w * h < width * height * 0.1) return null
  return { x: minX, y: minY, w, h }
}

// EXIF補正 + 縦向き強制 + 余白自動カット
async function makeOrientedPreviewUrl(file: File): Promise<string> {
  if (typeof createImageBitmap === 'undefined') return URL.createObjectURL(file)
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const isLandscape = bitmap.width > bitmap.height
    // 1) 縦向き化
    const c1 = document.createElement('canvas')
    if (isLandscape) {
      c1.width = bitmap.height
      c1.height = bitmap.width
      const ctx = c1.getContext('2d')!
      ctx.translate(c1.width / 2, c1.height / 2)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
    } else {
      c1.width = bitmap.width
      c1.height = bitmap.height
      c1.getContext('2d')!.drawImage(bitmap, 0, 0)
    }
    // 2) 余白自動カット
    const ctx1 = c1.getContext('2d')!
    const imgData = ctx1.getImageData(0, 0, c1.width, c1.height)
    const box = detectContentBox(imgData)
    let outCanvas: HTMLCanvasElement = c1
    if (box && (box.w < c1.width * 0.95 || box.h < c1.height * 0.95)) {
      const c2 = document.createElement('canvas')
      c2.width = box.w
      c2.height = box.h
      c2.getContext('2d')!.drawImage(c1, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
      outCanvas = c2
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
    })
    return URL.createObjectURL(blob)
  } catch {
    return URL.createObjectURL(file)
  }
}

// 画像をクロップ＋回転＋フィルタ適用してJPEG Fileを生成
async function processImage(
  file: File,
  cropArea: CropArea | null,
  rotation: number,
  brightness: number,
  contrast: number,
): Promise<File> {
  const img = await loadImage(file)

  const sx = cropArea?.x ?? 0
  const sy = cropArea?.y ?? 0
  const sw = cropArea?.width ?? img.width
  const sh = cropArea?.height ?? img.height

  const swap = rotation === 90 || rotation === 270
  const canvas = document.createElement('canvas')
  canvas.width = swap ? sh : sw
  canvas.height = swap ? sw : sh
  const ctx = canvas.getContext('2d')!
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(img.source, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9)
  })
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export default function SaitoSubmit() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [applyMonth, setApplyMonth] = useState(getCurrentApplyMonth())

  // 画像加工
  const [rotation, setRotation] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [extracted, setExtracted] = useState<{
    store_name: string | null
    date: string | null
    total_amount: number | null
    tax_amount: number | null
    tax_rate: number | null
    invoice_no: string | null
  } | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview) }
  }, [preview])

  const handleFile = async (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview)
    setRotation(0)
    setBrightness(100)
    setContrast(100)
    setSuccess(false)
    setExtracted(null)
    setError('')
    if (!f) { setFile(null); setPreview(null); return }
    if (f.type.startsWith('image/')) {
      // EXIF補正したblobで上書き（プレビューもsubmitもこれを使う）
      try {
        const orientedUrl = await makeOrientedPreviewUrl(f)
        // orientedUrlからFile作成（同名・JPEG）
        const blob = await fetch(orientedUrl).then(r => r.blob())
        const orientedFile = new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
        setFile(orientedFile)
        setPreview(orientedUrl)
        return
      } catch (e) {
        console.error('EXIF orient failed, fallback:', e)
      }
    }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const submit = async () => {
    if (!file) return setError('レシートを撮影または選択してください')
    setSubmitting(true); setError(''); setSuccess(false)
    try {
      let outFile = file
      if (file.type.startsWith('image/')) {
        const needsProc = rotation !== 0 || brightness !== 100 || contrast !== 100
        if (needsProc) outFile = await processImage(file, null, rotation, brightness, contrast)
      }
      const fd = new FormData()
      fd.append('file', outFile)
      fd.append('apply_month', applyMonth)

      const res = await fetch('/api/expenses/submit', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '送信に失敗しました')
      setExtracted(data.extracted || null)
      setSuccess(true)
      handleFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const openCamera = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.setAttribute('capture', 'environment')
      fileInputRef.current.click()
    }
  }

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.removeAttribute('capture')
      fileInputRef.current.click()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto p-4 pb-32 space-y-4">
        <h1 className="text-lg font-bold text-gray-800 pt-2">経費申請</h1>

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 flex items-start gap-2 text-green-800 text-sm">
              <span className="text-green-500 mt-0.5">✓</span>
              <div>
                <div className="font-medium">送信しました</div>
                <div className="text-xs text-green-600 mt-0.5">PJ・経費項目はPCで確定します</div>
              </div>
            </div>
            {extracted && (
              <div className="bg-white border-t border-green-200 px-4 py-3 space-y-1.5 text-xs">
                <div className="font-medium text-gray-700 mb-1.5">📝 OCR読み取り結果</div>
                <Row label="取引先" value={extracted.store_name} />
                <Row label="利用日" value={extracted.date} />
                <Row label="合計金額" value={extracted.total_amount != null ? `¥${extracted.total_amount.toLocaleString()}` : null} />
                <Row label="消費税" value={extracted.tax_amount != null ? `¥${extracted.tax_amount.toLocaleString()}` : null} />
                <Row label="税率" value={extracted.tax_rate != null ? `${(extracted.tax_rate * 100).toFixed(0)}%` : null} />
                <Row label="登録番号" value={extracted.invoice_no} />
                <p className="text-[10px] text-gray-400 pt-1">※ 誤りはPC側で修正できます</p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* 申請年月 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">申請年月</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setApplyMonth(shiftMonth(applyMonth, -1))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
              aria-label="前月"
            >▲</button>
            <span className="flex-1 text-center text-base font-medium text-gray-800 font-mono">{applyMonth}</span>
            <button
              type="button"
              onClick={() => setApplyMonth(shiftMonth(applyMonth, 1))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
              aria-label="翌月"
            >▼</button>
          </div>
        </div>

        {/* レシート */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            レシート / 領収書 <span className="text-red-400">*</span>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={e => handleFile(e.target.files?.[0] || null)}
            className="hidden"
          />

          {!file ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={openCamera}
                className="w-full py-6 border-2 border-dashed border-blue-300 rounded-xl text-blue-600 text-base font-medium hover:bg-blue-50 flex items-center justify-center gap-2"
              >
                <span className="text-2xl">📷</span> カメラで撮影
              </button>
              <button
                type="button"
                onClick={openFilePicker}
                className="w-full py-2.5 border border-gray-200 rounded-xl text-gray-500 text-sm hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                <span>📁</span> ファイルを選択
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* プレビュー */}
              {file.type.startsWith('image/') && preview ? (
                <>
                  <div className="bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
                    <img
                      src={preview}
                      alt="preview"
                      className="w-full h-auto block"
                      style={{
                        transform: `rotate(${rotation}deg)`,
                        filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                      }}
                    />
                  </div>

                  {/* 調整UI */}
                  <div className="space-y-3 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">回転</span>
                      <button
                        type="button"
                        onClick={() => setRotation((r) => (r + 270) % 360)}
                        className="flex-1 py-1.5 border border-gray-200 bg-white rounded text-sm hover:bg-gray-100"
                      >↺ 左90°</button>
                      <button
                        type="button"
                        onClick={() => setRotation((r) => (r + 90) % 360)}
                        className="flex-1 py-1.5 border border-gray-200 bg-white rounded text-sm hover:bg-gray-100"
                      >↻ 右90°</button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">明るさ</span>
                      <input
                        type="range"
                        min={50}
                        max={200}
                        value={brightness}
                        onChange={e => setBrightness(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-xs font-mono text-gray-500 w-10 text-right">{brightness}%</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">くっきり</span>
                      <input
                        type="range"
                        min={50}
                        max={200}
                        value={contrast}
                        onChange={e => setContrast(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-xs font-mono text-gray-500 w-10 text-right">{contrast}%</span>
                    </div>

                    {(rotation !== 0 || brightness !== 100 || contrast !== 100) && (
                      <button
                        type="button"
                        onClick={() => { setRotation(0); setBrightness(100); setContrast(100) }}
                        className="text-xs text-gray-500 hover:text-gray-800"
                      >調整をリセット</button>
                    )}
                  </div>

                  <p className="text-[11px] text-gray-400">
                    余白は自動でカット済み。必要なら回転・明るさで調整してください。
                  </p>
                </>
              ) : (
                <div className="bg-gray-100 px-3 py-3 rounded-lg text-sm text-gray-600 flex items-center gap-2">
                  <span>📄</span> {file.name}
                </div>
              )}

              {/* 撮り直し／削除 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={openCamera}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-gray-600 text-sm hover:bg-gray-50"
                >📷 撮り直す</button>
                <button
                  type="button"
                  onClick={() => handleFile(null)}
                  className="px-4 py-2.5 border border-gray-200 rounded-lg text-gray-400 text-sm hover:bg-gray-50"
                >× 削除</button>
              </div>

              <p className="text-[11px] text-gray-400">
                取引先・利用日・金額は自動取得。PJ・経費項目はPCで確定します。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 送信ボタン */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 max-w-lg mx-auto">
        <button
          onClick={submit}
          disabled={!file || submitting}
          className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-base hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? '送信中...' : file ? '送信する' : 'レシートを撮影してください'}
        </button>
      </div>
    </div>
  )
}
