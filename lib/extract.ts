import type { drive_v3 } from "googleapis";
import {
  DriveFile,
  PLAIN_TEXT_MIMES,
  downloadFileBytes,
  exportGoogleFileText,
  isGoogleExportable,
} from "@/lib/drive";

const MAX_EXCERPT_CHARS = 4000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20MB safety cap for content extraction

export interface ExtractedContent {
  text: string | null;
  contentAvailable: boolean;
}

/**
 * Best-effort text excerpt for a Drive file, used as classification signal.
 * Never throws: any extraction failure just falls back to filename/mimeType-only
 * classification for that file.
 */
export async function extractContent(
  drive: drive_v3.Drive,
  file: DriveFile
): Promise<ExtractedContent> {
  try {
    if (isGoogleExportable(file.mimeType)) {
      const text = await exportGoogleFileText(drive, file.id, file.mimeType, MAX_EXCERPT_CHARS);
      return { text, contentAvailable: text.trim().length > 0 };
    }

    const size = file.size ? Number(file.size) : undefined;
    if (size !== undefined && size > MAX_DOWNLOAD_BYTES) {
      return { text: null, contentAvailable: false };
    }

    if (PLAIN_TEXT_MIMES.has(file.mimeType)) {
      const bytes = await downloadFileBytes(drive, file.id);
      return { text: bytes.toString("utf8").slice(0, MAX_EXCERPT_CHARS), contentAvailable: true };
    }

    if (file.mimeType === "application/pdf") {
      const bytes = await downloadFileBytes(drive, file.id);
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(bytes, { max: 5 }); // first 5 pages is plenty of signal
      return { text: parsed.text.slice(0, MAX_EXCERPT_CHARS), contentAvailable: parsed.text.trim().length > 0 };
    }

    return { text: null, contentAvailable: false };
  } catch (err) {
    console.error(`extractContent failed for ${file.id} (${file.name})`, err);
    return { text: null, contentAvailable: false };
  }
}
