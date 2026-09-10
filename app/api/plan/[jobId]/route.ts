import { NextRequest, NextResponse } from "next/server";
import { getAuthedSession } from "@/lib/session";
import { getJob, saveJob } from "@/lib/jobs";

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

  return NextResponse.json(job);
}

interface PatchBody {
  fileId: string;
  userClass?: string | null;
  excluded?: boolean;
}

export async function PATCH(
  req: NextRequest,
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

  if (job.status !== "ready") {
    return NextResponse.json(
      { error: `Plan can only be edited while the job is in "ready" state (currently "${job.status}").` },
      { status: 409 }
    );
  }

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body?.fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const file = job.files.find((f) => f.id === body.fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found in this job" }, { status: 404 });
  }

  if (body.userClass !== undefined) {
    file.userClass = body.userClass?.trim() || undefined;
  }
  if (body.excluded !== undefined) {
    file.excluded = body.excluded;
  }

  saveJob(job);
  return NextResponse.json(file);
}
