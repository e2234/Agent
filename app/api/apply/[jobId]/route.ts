import { NextRequest, NextResponse } from "next/server";
import { getAuthedSession } from "@/lib/session";
import { getJob, saveJob } from "@/lib/jobs";
import { runApplyJob } from "@/lib/runner";

export async function POST(
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

  if (job.status !== "ready") {
    return NextResponse.json(
      { error: `Job must be in "ready" state to apply (currently "${job.status}").` },
      { status: 409 }
    );
  }

  job.status = "applying";
  saveJob(job);

  runApplyJob(job.id, session.accessToken).catch((err) => {
    console.error(`Unhandled error in apply job ${job.id}`, err);
  });

  return NextResponse.json({ ok: true });
}
