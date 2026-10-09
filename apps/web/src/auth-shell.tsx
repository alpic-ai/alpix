import type { ReactNode } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@alpic-ai/ui/components/alert";
import { H1 } from "@alpic-ai/ui/components/typography";
import { buttonVariants } from "@alpic-ai/ui/components/button";
import { MISSING_DESCOPE_PROJECT_ID } from "@alpix/auth/public";

export function AuthShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="app-backdrop text-foreground min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-4 md:p-6">
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="type-display-xs text-foreground no-underline">
            AlpiX
          </Link>
          <Link
            to="/"
            className={buttonVariants({ variant: "secondary", size: "pill" })}
          >
            Canvas
          </Link>
        </header>
        <main className="flex flex-1 flex-col gap-4">
          <H1 className="type-display-xs">{title}</H1>
          {children}
        </main>
      </div>
    </div>
  );
}

export function DescopeConfigError() {
  return (
    <div className="app-backdrop text-foreground min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-4 md:p-6">
        <H1 className="type-display-xs">AlpiX</H1>
        <Alert variant="destructive">
          <AlertTitle>Descope is not configured</AlertTitle>
          <AlertDescription>{MISSING_DESCOPE_PROJECT_ID}</AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

export function StartupError({ message }: { message: string }) {
  return (
    <div className="app-backdrop text-foreground min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-4 md:p-6">
        <H1 className="type-display-xs">AlpiX</H1>
        <Alert variant="destructive">
          <AlertTitle>AlpiX could not start</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
