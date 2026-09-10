import { google, drive_v3 } from "googleapis";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

const GOOGLE_EXPORTABLE: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

// Non-Google mime types we'll read directly as raw bytes for text extraction.
export const PLAIN_TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export function getDriveClient(accessToken: string): drive_v3.Drive {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

/**
 * Lists every non-trashed, non-folder file in the user's My Drive, excluding
 * anything already parented under `excludeSubtreeRootId` (the app's own
 * organize-root folder) so re-scans don't try to re-classify already-sorted
 * files.
 */
export async function listAllFiles(
  drive: drive_v3.Drive,
  opts: { excludeSubtreeRootId?: string } = {}
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  const excludedIds = opts.excludeSubtreeRootId
    ? await collectSubtreeIds(drive, opts.excludeSubtreeRootId)
    : new Set<string>();

  do {
    const res = await drive.files.list({
      q: `trashed = false and mimeType != '${FOLDER_MIME}' and mimeType != '${SHORTCUT_MIME}' and 'me' in owners`,
      fields:
        "nextPageToken, files(id, name, mimeType, parents, size, modifiedTime, webViewLink)",
      pageSize: 1000,
      pageToken,
      spaces: "drive",
    });

    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      const parents = f.parents ?? [];
      if (parents.some((p) => excludedIds.has(p))) continue;
      files.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        parents,
        size: f.size ?? undefined,
        modifiedTime: f.modifiedTime ?? undefined,
        webViewLink: f.webViewLink ?? undefined,
      });
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

async function collectSubtreeIds(drive: drive_v3.Drive, rootId: string): Promise<Set<string>> {
  const ids = new Set<string>([rootId]);
  const queue = [rootId];

  while (queue.length) {
    const parent = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `trashed = false and mimeType = '${FOLDER_MIME}' and '${parent}' in parents`,
        fields: "nextPageToken, files(id)",
        pageSize: 1000,
        pageToken,
      });
      for (const f of res.data.files ?? []) {
        if (f.id && !ids.has(f.id)) {
          ids.add(f.id);
          queue.push(f.id);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return ids;
}

export function isGoogleExportable(mimeType: string): boolean {
  return mimeType in GOOGLE_EXPORTABLE;
}

export async function exportGoogleFileText(
  drive: drive_v3.Drive,
  fileId: string,
  mimeType: string,
  maxChars: number
): Promise<string> {
  const exportMime = GOOGLE_EXPORTABLE[mimeType];
  if (!exportMime) throw new Error(`Unsupported Google mime type for export: ${mimeType}`);

  const res = await drive.files.export(
    { fileId, mimeType: exportMime },
    { responseType: "text" }
  );
  const text = typeof res.data === "string" ? res.data : String(res.data);
  return text.slice(0, maxChars);
}

export async function downloadFileBytes(
  drive: drive_v3.Drive,
  fileId: string
): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Finds a folder by exact name under `parentId` (My Drive root if omitted). Does not create it. */
export async function findFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string
): Promise<string | undefined> {
  const escapedName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? `'${parentId}' in parents` : "'root' in parents";
  const res = await drive.files.list({
    q: `trashed = false and mimeType = '${FOLDER_MIME}' and name = '${escapedName}' and ${parentClause}`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? undefined;
}

/** Finds a folder by exact name under `parentId` (My Drive root if omitted), creating it if absent. */
export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string
): Promise<string> {
  const existingId = await findFolder(drive, name, parentId);
  if (existingId) return existingId;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });

  if (!created.data.id) throw new Error(`Failed to create folder "${name}"`);
  return created.data.id;
}

export async function moveFile(
  drive: drive_v3.Drive,
  fileId: string,
  newParentId: string,
  oldParentIds: string[]
): Promise<void> {
  await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: oldParentIds.join(",") || undefined,
    fields: "id, parents",
  });
}
