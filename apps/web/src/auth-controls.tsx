import { useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { useDescope, useSession } from "@descope/react-sdk";
import { buttonVariants } from "@alpic-ai/ui/components/button";

export function AuthControls() {
  const { isAuthenticated, isSessionLoading } = useSession();
  const { logout } = useDescope();
  const navigate = useNavigate();

  const signOut = useCallback(() => {
    void logout().then(() => {
      navigate("/", { replace: true });
    });
  }, [logout, navigate]);

  if (isSessionLoading) {
    return (
      <span className="type-text-sm text-muted-foreground">Checking session…</span>
    );
  }

  if (!isAuthenticated) {
    return (
      <Link
        to="/sign-in"
        className={buttonVariants({ variant: "secondary", size: "pill" })}
      >
        Sign in
      </Link>
    );
  }

  return (
    <>
      <Link
        to="/account"
        className={buttonVariants({ variant: "secondary", size: "pill" })}
      >
        Account
      </Link>
      <button
        type="button"
        className={buttonVariants({ variant: "secondary", size: "pill" })}
        onClick={signOut}
      >
        Sign out
      </button>
    </>
  );
}
