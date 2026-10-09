export type AccountAccess = "unconfigured" | "loading" | "login" | "allow";

export function accountAccess(input: {
  configured: boolean;
  sessionLoading: boolean;
  authenticated: boolean;
}): AccountAccess {
  if (!input.configured) return "unconfigured";
  if (input.sessionLoading) return "loading";
  if (!input.authenticated) return "login";
  return "allow";
}
