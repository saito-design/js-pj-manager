// UPLOADS_FOLDER_SAITO 内のJPG/PNGをPDFに変換して上書き
// receipts.json の source_file 名と source_file_id も更新
// 使い方: node --env-file=.env.local scripts/convert_jpg_to_pdf.mjs [--dry-run] [--month YYYY-MM]

import { google } from 'googleapis'
import { JWT } from 'google-auth-library'
import { Readable } from 'stream'
import { PDFDocument } from 'pdf-lib'

const SAITO_DATA_FOLDER = '1LdM1jlSQniJ4nfWiZ3vKsIlIM_8AHveP'
const dryRun = process.argv.includes('--dry-run')
const monthArg = process.argv.indexOf('--month')
const monthFilter = monthArg >= 0 ? process.argv[monthArg + 1] : null  // e.g. "2026-04"

function clean(v) {
  if (!v) return undefined
  let c = v.trim()
  if (c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1)
  return c.replace(/\\n/g, '\n')
}

const auth = new JWT({
  email: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
  key: clean(process.env.GOOGLE_PRIVATE_KEY),
  scopes: ['https://www.googleapis.com/auth/drive'],
})
const drive = google.drive({ version: 'v3', auth })
const uploadsId = clean(process.env.UPLOADS_FOLDER_SAITO)

// receipts.json取得
const list = await drive.files.list({
  q: `name='receipts.json' and '${SAITO_DATA_FOLDER}' in parents and trashed=false`,
  fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true,
})
const fileId = list.data.files[0].id
const get = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'text' })
const receipts = JSON.parse(get.data)

// 対象抽出: 拡張子が画像系の source_file
function isImageName(s) { return /\.(jpe?g|png|webp)$/i.test(s || '') }
function pdfize(s) { return s.replace(/\.(jpe?g|png|webp|gif)$/i, '.pdf') }

const targets = receipts.filter(r =>
  r.source_file_id
  && isImageName(r.source_file)
  && (!monthFilter || (r.apply_month === monthFilter))
)
console.log(`変換対象: ${targets.length}件 (filter: ${monthFilter || '全期間'})`)

let converted = 0, skipped = 0
for (const r of targets) {
  try {
    // 1) 元ファイル取得
    const buf = await drive.files.get(
      { fileId: r.source_file_id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    ).then(res => Buffer.from(res.data))

    // 2) PDF生成
    const pdf = await PDFDocument.create()
    const ext = (r.source_file.match(/\.([^.]+)$/) || [])[1]?.toLowerCase()
    let img
    if (ext === 'png') img = await pdf.embedPng(buf)
    else img = await pdf.embedJpg(buf)
    const maxW = 595, maxH = 842
    const scale = Math.min(maxW / img.width, maxH / img.height, 1)
    const w = img.width * scale
    const h = img.height * scale
    const page = pdf.addPage([w, h])
    page.drawImage(img, { x: 0, y: 0, width: w, height: h })
    const pdfBuf = Buffer.from(await pdf.save())

    const newName = pdfize(r.source_file)

    if (dryRun) {
      console.log(`  [DRY] ${r.source_file} → ${newName} (${(pdfBuf.length/1024).toFixed(1)}KB)`)
      converted++
      continue
    }

    // 3) 新規アップロード（PDF）
    const created = await drive.files.create({
      requestBody: { name: newName, parents: [uploadsId] },
      media: { mimeType: 'application/pdf', body: Readable.from(pdfBuf) },
      fields: 'id', supportsAllDrives: true,
    })

    // 4) 旧JPGをゴミ箱
    await drive.files.update({
      fileId: r.source_file_id,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    })

    // 5) receipts.json レコード更新
    r.source_file = newName
    r.source_file_id = created.data.id
    r.updated_at = new Date().toISOString()
    converted++
    console.log(`  [OK] ${newName}`)
  } catch (e) {
    console.error(`  [ERR] ${r.source_file}: ${e.message}`)
    skipped++
  }
}

console.log(`\n変換完了: ${converted}件 / 失敗: ${skipped}件`)

if (!dryRun && converted > 0) {
  const body = JSON.stringify(receipts, null, 2)
  await drive.files.update({
    fileId,
    media: { mimeType: 'application/json', body: Readable.from(Buffer.from(body, 'utf-8')) },
    supportsAllDrives: true,
  })
  console.log('receipts.json 更新完了')
}
