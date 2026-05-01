// receipts.json の source_file_id=null のレコードについて、
// 経費_齋藤 フォルダから該当PDFを見つけて Drive にアップロード＋紐付け
// 使い方: node --env-file=.env.local scripts/upload_missing_receipts.mjs [--dry-run]

import { google } from 'googleapis'
import { JWT } from 'google-auth-library'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'

const RECEIPTS_FOLDER = 'C:/Users/yasuh/OneDrive - 株式会社日本コンサルタントグループ　/MyDocuments/000_スケジュール管理/経費_齋藤'
const SAITO_DATA_FOLDER = '1LdM1jlSQniJ4nfWiZ3vKsIlIM_8AHveP'
const dryRun = process.argv.includes('--dry-run')

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
console.log(`receipts: ${receipts.length}件`)

// ローカル経費_齋藤フォルダのPDFインデックス（normalized→fullpath）
function normalize(s) {
  return s.replace(/\s+/g, '').replace(/　/g, '').toLowerCase()
}
function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.toLowerCase().endsWith('.pdf')) out.push(p)
  }
  return out
}
const localFiles = walk(RECEIPTS_FOLDER)
const localIdx = new Map()
for (const fp of localFiles) {
  const name = path.basename(fp)
  localIdx.set(normalize(name), fp)
}
console.log(`ローカルPDF: ${localFiles.length}件`)

let uploaded = 0, missing = 0
for (const r of receipts) {
  if (r.source_file_id) continue
  if (!r.source_file) continue
  const nk = normalize(r.source_file)
  let localPath = localIdx.get(nk)
  if (!localPath) {
    // 部分一致
    for (const [k, v] of localIdx) {
      if (k.includes(nk) || nk.includes(k)) { localPath = v; break }
    }
  }
  if (!localPath) {
    missing++
    console.log(`  [未発見] ${r.source_file}`)
    continue
  }
  if (dryRun) {
    console.log(`  [DRY] ${r.source_file} → ${path.basename(localPath)}`)
    uploaded++
    continue
  }
  // Drive へアップロード
  const buf = fs.readFileSync(localPath)
  const stream = Readable.from(buf)
  const up = await drive.files.create({
    requestBody: { name: r.source_file, parents: [uploadsId] },
    media: { mimeType: 'application/pdf', body: stream },
    fields: 'id', supportsAllDrives: true,
  })
  r.source_file_id = up.data.id
  r.updated_at = new Date().toISOString()
  uploaded++
  console.log(`  [OK] ${r.source_file} → ${up.data.id}`)
}

console.log(`\nアップロード: ${uploaded}件 / 未発見: ${missing}件`)

if (!dryRun && uploaded > 0) {
  const body = JSON.stringify(receipts, null, 2)
  await drive.files.update({
    fileId, media: { mimeType: 'application/json', body: Readable.from(Buffer.from(body, 'utf-8')) },
    supportsAllDrives: true,
  })
  console.log('receipts.json 更新完了')
}
