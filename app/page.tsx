import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import SignIn from "@/components/SignIn";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const session = await getServerSession(authOptions);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Drive Class Organizer</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Scans your Google Drive, figures out which class each file belongs to, and files
          everything into per-class folders — nothing moves until you approve the plan.
        </p>
      </header>

      {session?.user ? (
        <Dashboard userEmail={session.user.email ?? ""} userName={session.user.name ?? undefined} />
      ) : (
        <SignIn />
      )}
    </main>
  );
}
