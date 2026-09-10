import { NextRequest, NextResponse } from "next/server";
import { getAuthedSession } from "@/lib/session";
import { getJob } from "@/lib/jobs";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const session = await getAuthedSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job || job.userId !== session.userId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    rootFolderName: job.rootFolderName,
    fileCount: job.files.length,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}
