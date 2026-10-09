import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Descope, useSession } from "@descope/react-sdk";
import { Alert, AlertDescription, AlertTitle } from "@alpic-ai/ui/components/alert";
import { descopeFlowId } from "./descope-public.js";
import { AuthShell } from "./auth-shell.js";
import { safeNextPath } from "./safe-path.js";

const NEXT_STORAGE_KEY = "alpix:post-auth-next";

function errorText(detail: unknown): string {
  if (detail && typeof detail === "object" && "errorDescription" in detail) {
    const description = detail.errorDescription;
    if (typeof description === "string" && description.trim()) return description;
  }
  return "Descope could not complete sign-in. Check that the sign-up-or-in flow is enabled for this project.";
}

export function SignInPage() {
  const { isAuthenticated, isSessionLoading } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const next = safeNextPath(params.get("next"));

  if (isSessionLoading) {
    return (
      <AuthShell title="Sign in">
        <p className="type-text-sm text-muted-foreground">Checking your session…</p>
      </AuthShell>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={next} replace />;
  }

  const redirectUrl = `${window.location.origin}/sign-in`;

  return (
    <AuthShell title="Sign in">
      <p className="type-text-sm text-muted-foreground">
        Create an account or sign in with Descope. The shared canvas stays
        available without an account; your public drawing name is still the
        nickname you pick on the canvas. If the form stays empty, Descope did
        not recognize this project or the <span className="font-mono">{descopeFlowId}</span> flow.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Sign-in failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Descope
        flowId={descopeFlowId}
        theme="dark"
        redirectUrl={redirectUrl}
        onSuccess={() => {
          const stored = safeNextPath(window.sessionStorage.getItem(NEXT_STORAGE_KEY));
          window.sessionStorage.removeItem(NEXT_STORAGE_KEY);
          navigate(next !== "/" ? next : stored, { replace: true });
        }}
        onError={(event) => {
          setError(errorText(event.detail));
        }}
        onReady={() => {
          window.sessionStorage.setItem(NEXT_STORAGE_KEY, next);
        }}
      />
    </AuthShell>
  );
}
