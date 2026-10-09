export type SessionUser = {
  userId: string;
  loginIds: string[];
  email?: string;
  name?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function sessionUserFromToken(
  token: Record<string, unknown> | null | undefined,
): SessionUser | null {
  if (!token) return null;
  const userId = asString(token.sub);
  if (!userId) return null;
  const loginIds = Array.isArray(token.loginIds)
    ? token.loginIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : [];
  const email = asString(token.email);
  const name = asString(token.name);
  return {
    userId,
    loginIds,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
  };
}
