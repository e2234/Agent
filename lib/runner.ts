import {
  DriveFile,
  findFolder,
  findOrCreateFolder,
  getDriveClient,
  listAllFiles,
  moveFile,
} from "@/lib/drive";
import { extractContent } from "@/lib/extract";
import { classifyFiles, ClassificationInput } from "@/lib/classify";
import { runWithConcurrency } from "@/lib/concurrency";
import { getJob, Job, PlanFile, saveJob } from "@/lib/jobs";

const EXTRACT_CONCURRENCY = 8;
const MOVE_CONCURRENCY = 5;

function touch(job: Job): void {
  saveJob(job);
}

/**
 * Scans the user's Drive, extracts content excerpts, and classifies every
 * file by class. Runs to completion in the background; callers poll job
 * status via lib/jobs.getJob. Never throws - failures are recorded on the
 * job itself so the background task doesn't produce an unhandled rejection.
 */
export async function runScanJob(jobId: string, accessToken: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  try {
    const drive = getDriveClient(accessToken);

    job.progress = { phase: "listing", current: 0, total: 0 };
    touch(job);

    const existingRootId = await findFolder(drive, job.rootFolderName);
    const files = await listAllFiles(drive, { excludeSubtreeRootId: existingRootId });

    job.progress = { phase: "extracting", current: 0, total: files.length };
    touch(job);

    let extracted = 0;
    const inputs: ClassificationInput[] = await runWithConcurrency(
      files,
      EXTRACT_CONCURRENCY,
      async (file: DriveFile) => {
        const { text, contentAvailable } = await extractContent(drive, file);
        extracted += 1;
        if (extracted % 5 === 0 || extracted === files.length) {
          job.progress = { phase: "extracting", current: extracted, total: files.length };
          touch(job);
        }
        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          excerpt: text,
          contentAvailable,
        };
      }
    );

    const filesById = new Map(files.map((f) => [f.id, f]));

    const classifications = await classifyFiles(inputs, (p) => {
      job.progress = {
        phase: p.stage === "classifying" ? "classifying" : "consolidating",
        current: p.batchesDone,
        total: p.batchesTotal,
      };
      touch(job);
    });

    const planFiles: PlanFile[] = classifications.map((c) => {
      const f = filesById.get(c.id)!;
      const input = inputs.find((i) => i.id === c.id);
      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        webViewLink: f.webViewLink,
        parents: f.parents,
        contentAvailable: input?.contentAvailable ?? false,
        proposedClass: c.proposedClass,
        confidence: c.confidence,
        reasoning: c.reasoning,
      };
    });

    job.files = planFiles;
    job.status = "ready";
    job.progress = { phase: "idle", current: planFiles.length, total: planFiles.length };
    touch(job);
  } catch (err) {
    console.error(`Scan job ${jobId} failed`, err);
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    touch(job);
  }
}

/**
 * Applies the (possibly user-edited) plan: creates one subfolder per class
 * under the job's root organize folder and moves each non-excluded file
 * into it. Per-file failures are recorded on that file rather than aborting
 * the whole run.
 */
export async function runApplyJob(jobId: string, accessToken: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  try {
    const drive = getDriveClient(accessToken);
    const rootId = await findOrCreateFolder(drive, job.rootFolderName);

    const toMove = job.files.filter((f) => !f.excluded && f.applyStatus !== "moved");

    job.status = "applying";
    job.progress = { phase: "moving", current: 0, total: toMove.length };
    touch(job);

    const folderCache = new Map<string, Promise<string>>();
    function folderFor(className: string): Promise<string> {
      let p = folderCache.get(className);
      if (!p) {
        p = findOrCreateFolder(drive, className, rootId);
        folderCache.set(className, p);
      }
      return p;
    }

    let done = 0;
    await runWithConcurrency(toMove, MOVE_CONCURRENCY, async (file) => {
      try {
        const className = (file.userClass || file.proposedClass || "Uncategorized").trim();
        const folderId = await folderFor(className);
        await moveFile(drive, file.id, folderId, file.parents);
        file.applyStatus = "moved";
        file.applyError = undefined;
      } catch (err) {
        file.applyStatus = "error";
        file.applyError = err instanceof Error ? err.message : String(err);
      } finally {
        done += 1;
        if (done % 3 === 0 || done === toMove.length) {
          job.progress = { phase: "moving", current: done, total: toMove.length };
          touch(job);
        }
      }
    });

    job.status = "done";
    job.progress = { phase: "idle", current: toMove.length, total: toMove.length };
    touch(job);
  } catch (err) {
    console.error(`Apply job ${jobId} failed`, err);
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    touch(job);
  }
}
