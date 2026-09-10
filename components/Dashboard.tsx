"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import type { Job, JobProgress, JobStatus, PlanFile } from "@/lib/jobs";

interface JobSummary {
  id: string;
  status: JobStatus;
  rootFolderName: string;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ScanStatus {
  id: string;
  status: JobStatus;
  progress: JobProgress;
  error?: string;
  rootFolderName: string;
  fileCount: number;
}

const LAST_JOB_KEY = "driveOrganizer:lastJobId";
const ACTIVE_STATUSES: JobStatus[] = ["scanning", "classifying", "applying"];

function phaseLabel(p: JobProgress): string {
  const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
  switch (p.phase) {
    case "listing":
      return "Listing files in your Drive…";
    case "extracting":
      return `Reading file contents (${p.current}/${p.total})…`;
    case "classifying":
      return `Classifying files (${p.current}/${p.total} batches, ${pct}%)…`;
    case "consolidating":
      return "Merging similar class names…";
    case "moving":
      return `Moving files (${p.current}/${p.total})…`;
    default:
      return "Working…";
  }
}

export default function Dashboard({ userEmail, userName }: { userEmail: string; userName?: string }) {
  const [rootFolderName, setRootFolderName] = useState("Organized by Class");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [plan, setPlan] = useState<Job | null>(null);
  const [history, setHistory] = useState<JobSummary[]>([]);
  const [starting, setStarting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(LAST_JOB_KEY) : null;
    if (saved) setJobId(saved);
    refreshHistory();
  }, []);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!jobId) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/scan/${jobId}`);
        if (!res.ok) return;
        const data: ScanStatus = await res.json();
        if (cancelled) return;
        setStatus(data);

        if (data.status === "ready" || data.status === "done") {
          await loadPlan(data.id);
          refreshHistory();
        }
        // Keep polling through "ready" (in case Apply is clicked) and stop
        // only once the job reaches a terminal state.
        if ((data.status === "done" || data.status === "error") && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // transient network error - next tick retries
      }
    }

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function refreshHistory() {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.jobs ?? []);
    } catch {
      // ignore
    }
  }

  async function loadPlan(id: string) {
    try {
      const res = await fetch(`/api/plan/${id}`);
      if (!res.ok) return;
      const data: Job = await res.json();
      setPlan(data);
    } catch {
      // ignore
    }
  }

  async function startScan() {
    setStarting(true);
    setGlobalError(null);
    setPlan(null);
    setStatus(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootFolderName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to start scan (${res.status})`);
      }
      const data = await res.json();
      localStorage.setItem(LAST_JOB_KEY, data.jobId);
      setJobId(data.jobId);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function updateFile(fileId: string, patch: { userClass?: string; excluded?: boolean }) {
    if (!jobId || !plan) return;
    // Optimistic local update
    setPlan({
      ...plan,
      files: plan.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)),
    });
    try {
      await fetch(`/api/plan/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, ...patch }),
      });
    } catch {
      // best-effort; a manual refresh will reconcile state
    }
  }

  async function applyPlan() {
    if (!jobId) return;
    setApplying(true);
    setGlobalError(null);
    try {
      const res = await fetch(`/api/apply/${jobId}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to apply plan (${res.status})`);
      }
      // Optimistic UI update; the existing poll loop (which keeps running
      // through "ready") picks up "applying" -> "done" from here.
      setStatus((s) => (s ? { ...s, status: "applying" } : s));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  function selectJob(id: string) {
    localStorage.setItem(LAST_JOB_KEY, id);
    setJobId(id);
    setPlan(null);
    setStatus(null);
    loadPlan(id);
  }

  const groups = useMemo(() => {
    if (!plan) return [];
    const map = new Map<string, PlanFile[]>();
    for (const f of plan.files) {
      const key = (f.userClass || f.proposedClass || "Uncategorized").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [plan]);

  const isBusy = status ? ACTIVE_STATUSES.includes(status.status) : false;
  const isReady = status?.status === "ready" || plan?.status === "ready";
  const isDone = status?.status === "done" || plan?.status === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, color: "var(--muted)" }}>
          Signed in as {userName ? `${userName} (${userEmail})` : userEmail}
        </div>
        <button onClick={() => signOut()} style={linkButtonStyle}>
          Sign out
        </button>
      </div>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>1. Scan your Drive</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>
            Root folder name:{" "}
            <input
              value={rootFolderName}
              onChange={(e) => setRootFolderName(e.target.value)}
              disabled={isBusy}
              style={inputStyle}
            />
          </label>
          <button
            onClick={startScan}
            disabled={starting || isBusy}
            style={primaryButtonStyle}
          >
            {starting || (status && ["scanning", "classifying"].includes(status.status))
              ? "Scanning…"
              : "Start Scan"}
          </button>
        </div>
        {status && ["scanning", "classifying"].includes(status.status) && (
          <p style={{ fontSize: 13, color: "var(--muted)" }}>{phaseLabel(status.progress)}</p>
        )}
        {status?.status === "error" && (
          <p style={{ color: "var(--danger)", fontSize: 13 }}>Scan failed: {status.error}</p>
        )}
        {globalError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{globalError}</p>}
      </section>

      {plan && plan.files.length > 0 && (
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>
              2. Review the plan ({plan.files.length} files, {groups.length} classes)
            </h2>
            {isReady && (
              <button onClick={applyPlan} disabled={applying} style={primaryButtonStyle}>
                {applying || status?.status === "applying" ? "Applying…" : "Apply Plan"}
              </button>
            )}
          </div>
          {status?.status === "applying" && (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>{phaseLabel(status.progress)}</p>
          )}
          {isDone && <p style={{ fontSize: 13, color: "var(--ok)" }}>Done — files have been moved.</p>}
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Nothing moves until you click Apply. Rename a class to merge files into it, or uncheck a
            file to leave it where it is.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {groups.map(([className, files]) => (
              <div key={className} style={groupStyle}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {className} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({files.length})</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {files.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto auto",
                        gap: 8,
                        alignItems: "center",
                        fontSize: 13,
                        opacity: f.excluded ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!f.excluded}
                        disabled={!isReady}
                        onChange={(e) => updateFile(f.id, { excluded: !e.target.checked })}
                        title="Include in move"
                      />
                      <span>
                        {f.webViewLink ? (
                          <a href={f.webViewLink} target="_blank" rel="noreferrer">
                            {f.name}
                          </a>
                        ) : (
                          f.name
                        )}
                        {!f.contentAvailable && (
                          <span style={{ color: "var(--muted)" }}> (filename only)</span>
                        )}
                      </span>
                      <input
                        defaultValue={f.userClass || f.proposedClass}
                        disabled={!isReady}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== (f.userClass || f.proposedClass)) {
                            updateFile(f.id, { userClass: v });
                          }
                        }}
                        style={{ ...inputStyle, width: 160 }}
                        title={f.reasoning}
                      />
                      {f.applyStatus === "moved" && <span style={{ color: "var(--ok)" }}>moved</span>}
                      {f.applyStatus === "error" && (
                        <span style={{ color: "var(--danger)" }} title={f.applyError}>
                          error
                        </span>
                      )}
                      {!f.applyStatus && <span style={{ color: "var(--muted)" }}>{Math.round(f.confidence * 100)}%</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>History</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {history.map((j) => (
              <button key={j.id} onClick={() => selectJob(j.id)} style={historyRowStyle}>
                <span>{new Date(j.createdAt).toLocaleString()}</span>
                <span style={{ color: "var(--muted)" }}>{j.rootFolderName}</span>
                <span>{j.fileCount} files</span>
                <span style={{ fontWeight: 600 }}>{j.status}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
};

const groupStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 12,
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  fontSize: 13,
};

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 14,
  cursor: "pointer",
};

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 13,
  padding: 0,
};

const historyRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr auto auto",
  gap: 12,
  padding: "6px 8px",
  border: "none",
  background: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};
