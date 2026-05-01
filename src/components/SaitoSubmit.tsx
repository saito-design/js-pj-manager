'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Cropper, { Area } from 'react-easy-crop'

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

// EXIF 補正済の画像を Blob URL として返す（プレビュー/Cropper 用）
async function makeOrientedPreviewUrl(file: File): Promise<string> {
  if (typeof createImageBitmap === 'undefined') return URL.createObjectURL(file)
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const c = document.createElement('canvas')
    c.width = bitmap.width
    c.height = bitmap.height
    c.getContext('2d')!.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => {
      c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
    })
    return URL.createObjectURL(blob)
  } catch {
    return URL.createObjectURL(file)
  }
}

// 画像をクロップ＋回転＋フィルタ適用してJPEG Fileを生成
async function processImage(
  file: File,
  cropArea: Area | null,
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
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
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

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  const handleFile = async (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
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
        const needsProc = !!croppedAreaPixels || rotation !== 0 || brightness !== 100 || contrast !== 100
        if (needsProc) outFile = await processImage(file, croppedAreaPixels, rotation, brightness, contrast)
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
              {/* プレビュー＋クロップ */}
              {file.type.startsWith('image/') && preview ? (
                <>
                  <div className="relative bg-black rounded-lg overflow-hidden" style={{ height: '60vh', minHeight: '300px' }}>
                    <Cropper
                      image={preview}
                      crop={crop}
                      zoom={zoom}
                      rotation={rotation}
                      aspect={undefined}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onRotationChange={setRotation}
                      onCropComplete={onCropComplete}
                      restrictPosition={false}
                      style={{ mediaStyle: { filter: `brightness(${brightness}%) contrast(${contrast}%)` } }}
                    />
                  </div>

                  {/* 調整UI */}
                  <div className="space-y-3 bg-gray-50 rounded-lg p-3">
                    {/* 拡大 */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12">拡大</span>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.05}
                        value={zoom}
                        onChange={e => setZoom(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-xs font-mono text-gray-500 w-10 text-right">{zoom.toFixed(1)}x</span>
                    </div>

                    {/* 回転 */}
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

                    {/* 明るさ */}
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

                    {/* コントラスト */}
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

                    {/* リセット */}
                    {(zoom !== 1 || rotation !== 0 || brightness !== 100 || contrast !== 100) && (
                      <button
                        type="button"
                        onClick={() => { setZoom(1); setRotation(0); setBrightness(100); setContrast(100); setCrop({ x: 0, y: 0 }) }}
                        className="text-xs text-gray-500 hover:text-gray-800"
                      >調整をリセット</button>
                    )}
                  </div>

                  <p className="text-[11px] text-gray-400">
                    ピンチ／ドラッグでトリミング。範囲外も指定可能です。
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
