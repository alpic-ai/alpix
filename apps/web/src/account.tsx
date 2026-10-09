import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { useDescope, useSession, useUser } from "@descope/react-sdk";
import { Alert, AlertDescription, AlertTitle } from "@alpic-ai/ui/components/alert";
import { AuthShell } from "./auth-shell.js";
import {
  fetchVerifiedSession,
  type VerifiedSessionUser,
} from "./session-client.js";
import { safeNextPath } from "./safe-path.js";

type Gate =
  | { kind: "loading" }
  | { kind: "denied"; status: number; error: string }
  | { kind: "ready"; user: VerifiedSessionUser };

export function RequireSession() {
  const { isAuthenticated, isSessionLoading, sessionToken } = useSession();
  const { logout } = useDescope();
  const location = useLocation();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const rejectedSession = useRef(false);
  const next = safeNextPath(`${location.pathname}${location.search}`);

  useEffect(() => {
    if (isSessionLoading) return;
    if (!isAuthenticated || !sessionToken) {
      setGate({ kind: "denied", status: 401, error: "Sign in required." });
      return;
    }

    let cancelled = false;
    setGate({ kind: "loading" });
    void fetchVerifiedSession(sessionToken).then((result) => {
      if (cancelled) return;
      if (result.ok) setGate({ kind: "ready", user: result.user });
      else setGate({ kind: "denied", status: result.status, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isSessionLoading, sessionToken]);

  useEffect(() => {
    if (rejectedSession.current) return;
    if (gate.kind === "denied" && gate.status === 401 && isAuthenticated) {
      rejectedSession.current = true;
      void logout();
    }
  }, [gate, isAuthenticated, logout]);

  if (isSessionLoading || gate.kind === "loading") {
    return (
      <AuthShell title="Account">
        <p className="type-text-sm text-muted-foreground">
          Validating your Descope session…
        </p>
      </AuthShell>
    );
  }

  if (gate.kind === "denied") {
    if (gate.status === 401 && isAuthenticated) {
      return (
        <AuthShell title="Account">
          <p className="type-text-sm text-muted-foreground">
            The server rejected this session. Signing you out…
          </p>
        </AuthShell>
      );
    }
    if (gate.status === 401 || !isAuthenticated) {
      return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />;
    }
    return (
      <AuthShell title="Account">
        <Alert variant="destructive">
          <AlertTitle>Session was not accepted</AlertTitle>
          <AlertDescription>{gate.error}</AlertDescription>
        </Alert>
      </AuthShell>
    );
  }

  return <AccountPage user={gate.user} />;
}

export function AccountPage({ user }: { user: VerifiedSessionUser }) {
  const { user: profile, isUserLoading } = useUser();
  const displayName =
    user.name ||
    (!isUserLoading ? profile?.name || profile?.email : undefined) ||
    user.userId;

  return (
    <AuthShell title="Account">
      <p className="type-text-sm text-muted-foreground">
        This page is available only after the server validates your Descope
        session JWT. Drawings on the canvas are still attributed to the public
        nickname you choose there.
      </p>
      <dl className="grid gap-3">
        <div>
          <dt className="type-text-sm text-muted-foreground">Signed in as</dt>
          <dd className="type-text-md">{displayName}</dd>
        </div>
        <div>
          <dt className="type-text-sm text-muted-foreground">User id</dt>
          <dd className="type-text-sm break-all font-mono">{user.userId}</dd>
        </div>
        {user.email && (
          <div>
            <dt className="type-text-sm text-muted-foreground">Email on the session</dt>
            <dd className="type-text-sm">{user.email}</dd>
          </div>
        )}
        {user.loginIds.length > 0 && (
          <div>
            <dt className="type-text-sm text-muted-foreground">Login ids</dt>
            <dd className="type-text-sm">{user.loginIds.join(", ")}</dd>
          </div>
        )}
      </dl>
    </AuthShell>
  );
}
