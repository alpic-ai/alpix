import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";
import { Descope, useSession } from "@descope/react-sdk";
import { Alert, AlertDescription, AlertTitle } from "@alpic-ai/ui/components/alert";
import { descopeFlowId } from "../auth/config.js";
import { AuthLoading, AuthShell } from "../auth/shell.js";

export function LoginPage() {
  const { isAuthenticated, isSessionLoading } = useSession();
  const [error, setError] = useState<string | null>(null);
  const flowId = descopeFlowId();
  const loadTimer = useRef<number | null>(null);

  useEffect(() => {
    loadTimer.current = window.setTimeout(() => {
      setError((current) =>
        current ??
        "The Descope flow did not load. Check the project ID, the flow ID, and the project's allowed domains.",
      );
    }, 4000);
    return () => {
      if (loadTimer.current !== null) window.clearTimeout(loadTimer.current);
    };
  }, []);

  if (isSessionLoading) {
    return <AuthLoading label="Checking your session…" />;
  }
  if (isAuthenticated) {
    return <Navigate to="/account" replace />;
  }

  return (
    <AuthShell title="Sign up or log in">
      <p className="type-text-sm text-muted-foreground">
        Use the Descope <code>{flowId}</code> flow. The shared canvas stays available
        without an account.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not sign in</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="min-h-80">
        <Descope
          flowId={flowId}
          theme="dark"
          onReady={() => {
            if (loadTimer.current !== null) window.clearTimeout(loadTimer.current);
            setError(null);
          }}
          onSuccess={() => {
            setError(null);
            window.location.assign("/account");
          }}
          onError={() => {
            setError("The Descope flow could not complete. Check the flow ID and project ID.");
          }}
        />
      </div>
    </AuthShell>
  );
}
