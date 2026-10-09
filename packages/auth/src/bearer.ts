const MAX_TOKEN_LENGTH = 16_000;

export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const token = match?.[1];
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}
