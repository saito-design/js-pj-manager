// Driveからレシート画像をダウンロード（node --env-file=.env.local 前提）
import { google } from 'googleapis'
import { JWT } from 'google-auth-library'
import fs from 'fs'

const fileId = process.argv[2]
const out = process.argv[3] || 'receipt.jpg'

function clean(v) {
  if (!v) return undefined
  let c = v.trim()
  if (c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1)
  return c.replace(/\\n/g, '\n')
}

const auth = new JWT({
  email: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
  key: clean(process.env.GOOGLE_PRIVATE_KEY),
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
})
const drive = google.drive({ version: 'v3', auth })
const res = await drive.files.get(
  { fileId, alt: 'media', supportsAllDrives: true },
  { responseType: 'arraybuffer' },
)
fs.writeFileSync(out, Buffer.from(res.data))
console.log(`saved ${out} (${fs.statSync(out).size} bytes)`)
