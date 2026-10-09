import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { getSessionToken, useDescope, useUser } from "@descope/react-sdk";
import { Alert, AlertDescription, AlertTitle } from "@alpic-ai/ui/components/alert";
import { buttonVariants } from "@alpic-ai/ui/components/button";
import { AuthShell } from "../auth/shell.js";

type ServerState =
  | { kind: "loading" }
  | { kind: "ok"; userId: string; email?: string; name?: string }
  | { kind: "error"; message: string };

export function AccountPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { logout } = useDescope();
  const [server, setServer] = useState<ServerState>({ kind: "loading" });

  useEffect(() => {
    const token = getSessionToken();
    if (!token) {
      setServer({
        kind: "error",
        message: "No session token is available to send to the API.",
      });
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          error?: string;
          user?: { userId?: string; email?: string; name?: string };
        };
        if (!response.ok || !body.user?.userId) {
          setServer({
            kind: "error",
            message: body.error || "The session API rejected this token.",
          });
          return;
        }
        setServer({
          kind: "ok",
          userId: body.user.userId,
          email: body.user.email,
          name: body.user.name,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setServer({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not reach the session API.",
        });
      }
    })();

    return () => controller.abort();
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/");
  }, [logout, navigate]);

  const name = user?.name || (server.kind === "ok" ? server.name : undefined);
  const email = user?.email || (server.kind === "ok" ? server.email : undefined);

  return (
    <AuthShell title="Your account">
      <p className="type-text-sm text-muted-foreground">
        This page is signed-in only. The session token is checked again by{" "}
        <code>GET /api/me</code> with the Descope Node SDK.
      </p>
      <dl className="type-text-sm grid gap-2">
        <div>
          <dt className="text-muted-foreground">Name</dt>
          <dd>{name || "Not set"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{email || "Not set"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">User ID</dt>
          <dd className="font-mono break-all">
            {server.kind === "ok"
              ? server.userId
              : server.kind === "loading"
                ? "Validating session…"
                : "Unavailable"}
          </dd>
        </div>
      </dl>
      {server.kind === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Session was not accepted</AlertTitle>
          <AlertDescription>{server.message}</AlertDescription>
        </Alert>
      )}
      {server.kind === "ok" && (
        <Alert variant="success">
          <AlertTitle>Session verified</AlertTitle>
          <AlertDescription>
            The API accepted this Descope session token.
          </AlertDescription>
        </Alert>
      )}
      <button
        type="button"
        onClick={() => {
          void handleLogout();
        }}
        className={buttonVariants({ variant: "secondary", size: "pill" })}
      >
        Log out
      </button>
    </AuthShell>
  );
}
