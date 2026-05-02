import { PDFDocument } from 'pdf-lib';

// JPG/PNG画像のBufferを単一ページPDFのBufferに変換
export async function imageBufferToPdfBuffer(buf: Buffer, mime: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let img;
  if (mime === 'image/png') {
    img = await pdf.embedPng(bytes);
  } else {
    // JPEG (image/jpeg, image/jpg) を想定
    img = await pdf.embedJpg(bytes);
  }
  // A4 (595 x 842 pt) に収まるように縮小
  const maxW = 595, maxH = 842;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  const page = pdf.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

// MIMEタイプから画像か判定し、画像なら拡張子を.pdfに置換した名前を返す
export function pdfizeFilename(filename: string): string {
  return filename.replace(/\.(jpe?g|png|webp|gif)$/i, '.pdf');
}
