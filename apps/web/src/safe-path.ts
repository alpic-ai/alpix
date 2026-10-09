/** Same-origin path only. Rejects protocol-relative and off-site values. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\s\\]/.test(value)) return "/";
  return value;
}
