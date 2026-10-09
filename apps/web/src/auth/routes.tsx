import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "@descope/react-sdk";
import { accountAccess } from "./access.js";
import { descopeProjectId } from "./config.js";
import { AuthLoading, AuthUnconfigured } from "./shell.js";
import { AccountPage } from "../pages/account-page.js";
import { LoginPage } from "../pages/login-page.js";

function AccountGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, isSessionLoading } = useSession();
  const access = accountAccess({
    configured: true,
    sessionLoading: isSessionLoading,
    authenticated: isAuthenticated,
  });

  if (access === "loading") {
    return <AuthLoading label="Checking your session…" />;
  }
  if (access === "login") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export function LoginRoute() {
  if (!descopeProjectId()) return <AuthUnconfigured />;
  return <LoginPage />;
}

export function AccountRoute() {
  if (!descopeProjectId()) return <AuthUnconfigured />;
  return (
    <AccountGate>
      <AccountPage />
    </AccountGate>
  );
}
