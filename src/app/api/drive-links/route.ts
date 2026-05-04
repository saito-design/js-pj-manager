import { NextResponse } from 'next/server'

export async function GET() {
  const uploadsId = process.env.UPLOADS_FOLDER_SAITO
  const companyId = process.env.COMPANY_FOLDER_SAITO
  return NextResponse.json({
    uploads_url: uploadsId ? `https://drive.google.com/drive/folders/${uploadsId}` : null,
    company_url: companyId ? `https://drive.google.com/drive/folders/${companyId}` : null,
  })
}
