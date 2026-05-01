import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Readable } from 'stream';

const SCOPES = ['https://www.googleapis.com/auth/drive'];

function cleanEnvVar(val: string | undefined): string | undefined {
  if (!val) return undefined;
  let clean = val.trim();
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.substring(1, clean.length - 1);
  }
  return clean.replace(/\\n/g, '\n');
}

const auth = new JWT({
  email: cleanEnvVar(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
  key: cleanEnvVar(process.env.GOOGLE_PRIVATE_KEY),
  scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

export function getDataFolderId(): string {
  const id = process.env.COMPANY_FOLDER_SAITO;
  if (!id) throw new Error('COMPANY_FOLDER_SAITO is not configured');
  return id;
}

export async function findFileByName(
  name: string,
  folderId?: string,
): Promise<string | null> {
  const parent = folderId;
  if (!parent) throw new Error('findFileByName: folderId required');
  const res = await drive.files.list({
    q: `name='${name}' and '${parent}' in parents and trashed=false`,
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 1,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const files = res.data.files || [];
  return files.length > 0 ? files[0].id! : null;
}

export async function readJsonFile<T>(fileId: string): Promise<T> {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  const text = Buffer.from(res.data as ArrayBuffer).toString('utf-8');
  return JSON.parse(text) as T;
}

export async function loadJsonByName<T>(filename: string, folderId: string): Promise<T> {
  const fileId = await findFileByName(filename, folderId);
  if (!fileId) {
    throw new Error(`File not found: ${filename}`);
  }
  return readJsonFile<T>(fileId);
}

export async function listSubfolders(parentId: string): Promise<{ id: string; name: string }[]> {
  const parent = parentId;
  if (!parent) throw new Error('listSubfolders: parentId required');
  const res = await drive.files.list({
    q: `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: 100,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  return (res.data.files || []).map(f => ({ id: f.id!, name: f.name! }));
}

export async function listFilesInFolder(folderId: string): Promise<{
  id: string; name: string; mimeType: string; size: string; modifiedTime: string;
}[]> {
  const imageMimes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
    'application/pdf',
  ];
  const mimeFilter = imageMimes.map(m => `mimeType='${m}'`).join(' or ');
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (${mimeFilter}) and trashed=false`,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    orderBy: 'name',
    pageSize: 200,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  return (res.data.files || []).map(f => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    size: f.size || '0',
    modifiedTime: f.modifiedTime || '',
  }));
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function renameFile(fileId: string, newName: string): Promise<void> {
  await drive.files.update({
    fileId,
    requestBody: { name: newName },
    supportsAllDrives: true,
  });
}

export async function saveJsonFile<T>(
  filename: string,
  data: T,
  folderId: string,
): Promise<string> {
  const parent = folderId;
  if (!parent) throw new Error('saveJsonFile: folderId required');
  const content = JSON.stringify(data, null, 2);
  const stream = Readable.from([content]);

  const existingId = await findFileByName(filename, parent);

  if (existingId) {
    await drive.files.update({
      fileId: existingId,
      media: { mimeType: 'application/json', body: stream },
      supportsAllDrives: true,
    });
    return existingId;
  }

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType: 'application/json',
      parents: [parent],
    },
    media: { mimeType: 'application/json', body: stream },
    fields: 'id',
    supportsAllDrives: true,
  });
  return res.data.id!;
}
