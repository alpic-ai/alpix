import { useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { LogOut } from "lucide-react";
import { useDescope, useSession, useUser } from "@descope/react-sdk";
import { buttonVariants } from "@alpic-ai/ui/components/button";
import { descopeProjectId } from "./config.js";

function SignedInHeader() {
  const navigate = useNavigate();
  const { isAuthenticated, isSessionLoading } = useSession();
  const { user } = useUser();
  const { logout } = useDescope();

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/");
  }, [logout, navigate]);

  if (isSessionLoading) {
    return (
      <span className="type-text-xs text-muted-foreground">Checking session…</span>
    );
  }

  if (!isAuthenticated) {
    return (
      <Link
        to="/login"
        className={buttonVariants({ variant: "secondary", size: "pill" })}
      >
        Sign in
      </Link>
    );
  }

  const label = user?.name || user?.email || "Account";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to="/account"
        className={buttonVariants({ variant: "secondary", size: "pill" })}
      >
        {label}
      </Link>
      <button
        type="button"
        onClick={() => {
          void handleLogout();
        }}
        className={`${buttonVariants({ variant: "secondary", size: "pill" })} inline-flex items-center gap-1.5`}
      >
        <LogOut className="size-3.5" />
        Log out
      </button>
    </div>
  );
}

/** Sign-in controls. Hidden when Descope is not configured so the canvas stays unchanged. */
export function HeaderAuth() {
  if (!descopeProjectId()) return null;
  return <SignedInHeader />;
}
