import { NextResponse } from "next/server";
import { getAuthedSession } from "@/lib/session";
import { listJobs } from "@/lib/jobs";

export async function GET() {
  const session = await getAuthedSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const jobs = listJobs(session.userId).map((j) => ({
    id: j.id,
    status: j.status,
    rootFolderName: j.rootFolderName,
    fileCount: j.files.length,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  }));

  return NextResponse.json({ jobs });
}
