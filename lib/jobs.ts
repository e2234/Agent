import fs from "fs";
import path from "path";

export type JobStatus =
  | "scanning"
  | "classifying"
  | "ready"
  | "applying"
  | "done"
  | "error";

export interface PlanFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  parents: string[];
  contentAvailable: boolean;
  proposedClass: string;
  confidence: number;
  reasoning: string;
  /** User override of proposedClass, if they edited the plan. */
  userClass?: string;
  /** User opted this file out of the move entirely. */
  excluded?: boolean;
  applyStatus?: "pending" | "moved" | "error";
  applyError?: string;
}

export interface JobProgress {
  phase: "listing" | "extracting" | "classifying" | "consolidating" | "moving" | "idle";
  current: number;
  total: number;
}

export interface Job {
  id: string;
  userId: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  rootFolderName: string;
  progress: JobProgress;
  files: PlanFile[];
  error?: string;
}

const JOBS_DIR = path.join(process.cwd(), "data", "jobs");
const jobs = new Map<string, Job>();

function ensureDir(): void {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function filePath(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

export function saveJob(job: Job): void {
  job.updatedAt = new Date().toISOString();
  jobs.set(job.id, job);
  try {
    ensureDir();
    fs.writeFileSync(filePath(job.id), JSON.stringify(job));
  } catch (err) {
    console.error(`Failed to persist job ${job.id}`, err);
  }
}

export function getJob(id: string): Job | undefined {
  const cached = jobs.get(id);
  if (cached) return cached;

  try {
    const raw = fs.readFileSync(filePath(id), "utf8");
    const job = JSON.parse(raw) as Job;
    jobs.set(id, job);
    return job;
  } catch {
    return undefined;
  }
}

export function listJobs(userId: string): Job[] {
  ensureDir();
  const idsOnDisk = fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

  const all = new Set<string>([...jobs.keys(), ...idsOnDisk]);
  const result: Job[] = [];
  for (const id of all) {
    const job = getJob(id);
    if (job && job.userId === userId) result.push(job);
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
