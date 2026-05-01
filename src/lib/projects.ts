import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import type { Project } from '@/types';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function clean(v: string | undefined): string | undefined {
  if (!v) return undefined;
  let c = v.trim();
  if (c.startsWith('"') && c.endsWith('"')) c = c.slice(1, -1);
  return c.replace(/\\n/g, '\n');
}

function getDrive() {
  const auth = new JWT({
    email: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: clean(process.env.GOOGLE_PRIVATE_KEY),
    scopes: SCOPES,
  });
  return google.drive({ version: 'v3', auth });
}

function parseBudgetFilename(filename: string): { pj_no: string; client_name: string; case_name: string } | null {
  const noExt = filename.replace(/\.(xlsm|xlsx|xls)$/i, '');
  const trimmed = noExt.replace(/[\s_　]*予算書\s*$/, '');
  const parts = trimmed.split('_');
  if (parts.length < 3) return null;
  const pj_no = parts[0];
  const client_name = parts[1];
  const case_name = parts.slice(2).join('_').replace(/^\s+|\s+$/g, '');
  return { pj_no, client_name, case_name };
}

export async function loadProjects(): Promise<Project[]> {
  const folderId = process.env.BUDGET_FOLDER_SAITO;
  if (!folderId) return [];

  const drive = getDrive();
  const all: Project[] = [];
  let pageToken: string | null | undefined = undefined;
  while (true) {
    const res: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType)',
      pageSize: 200,
      pageToken: pageToken || undefined,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = res.data.files || [];
    for (const f of files) {
      if (!f.name) continue;
      const parsed = parseBudgetFilename(f.name);
      if (!parsed) continue;
      all.push({
        ...parsed,
        display_name: `${parsed.pj_no} ${parsed.case_name}`,
        budget_file_id: f.id || undefined,
      });
    }
    pageToken = res.data.nextPageToken;
    if (!pageToken) break;
  }
  all.sort((a, b) => b.pj_no.localeCompare(a.pj_no));
  return all;
}
