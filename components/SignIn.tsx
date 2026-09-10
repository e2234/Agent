"use client";

import { signIn } from "next-auth/react";

export default function SignIn() {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 28,
        textAlign: "center",
      }}
    >
      <p style={{ marginTop: 0 }}>
        Connect your Google account to let the agent read and reorganize your Drive.
      </p>
      <button
        onClick={() => signIn("google")}
        style={{
          background: "var(--accent)",
          color: "white",
          border: "none",
          borderRadius: 8,
          padding: "10px 20px",
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        Sign in with Google
      </button>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 16 }}>
        Requires full Drive access (not just files this app creates) so it can move files you
        already have. You can revoke access anytime from your Google Account permissions page.
      </p>
    </div>
  );
}
