import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export interface AuthedSession {
  userId: string;
  accessToken: string;
}

/** Resolves the current session's user id + a live Drive access token, or null if unauthenticated / token invalid. */
export async function getAuthedSession(): Promise<AuthedSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || session.error) return null;
  const userId = session.user?.email;
  if (!userId) return null;
  return { userId, accessToken: session.accessToken };
}
