import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAuthedSession } from "@/lib/session";
import { Job, saveJob } from "@/lib/jobs";
import { runScanJob } from "@/lib/runner";

export async function POST(req: NextRequest) {
  const session = await getAuthedSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rootFolderName =
    typeof body.rootFolderName === "string" && body.rootFolderName.trim()
      ? body.rootFolderName.trim()
      : process.env.ORGANIZE_ROOT_FOLDER_NAME || "Organized by Class";

  const job: Job = {
    id: crypto.randomUUID(),
    userId: session.userId,
    status: "scanning",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rootFolderName,
    progress: { phase: "listing", current: 0, total: 0 },
    files: [],
  };
  saveJob(job);

  // Fire and forget - the client polls GET /api/scan/[jobId] for progress.
  // Requires a long-lived Node process (next start / self-hosted), not a
  // serverless function platform that kills the process after the response.
  runScanJob(job.id, session.accessToken).catch((err) => {
    console.error(`Unhandled error in scan job ${job.id}`, err);
  });

  return NextResponse.json({ jobId: job.id });
}
