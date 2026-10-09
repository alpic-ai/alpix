export type VerifiedSessionUser = {
  userId: string;
  loginIds: string[];
  email?: string;
  name?: string;
};

export type VerifiedSessionResult =
  | { ok: true; user: VerifiedSessionUser }
  | { ok: false; status: number; error: string };

function isUser(value: unknown): value is VerifiedSessionUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<VerifiedSessionUser>;
  return typeof user.userId === "string" && user.userId.length > 0;
}

export async function fetchVerifiedSession(
  sessionToken: string,
): Promise<VerifiedSessionResult> {
  let response: Response;
  try {
    response = await fetch("/api/session", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "Could not reach the session API.",
    };
  }

  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    user?: unknown;
  } | null;

  if (!response.ok || !isUser(body?.user)) {
    const error =
      body && typeof body.error === "string"
        ? body.error
        : "Descope session could not be verified.";
    return { ok: false, status: response.status, error };
  }

  return { ok: true, user: body.user };
}
