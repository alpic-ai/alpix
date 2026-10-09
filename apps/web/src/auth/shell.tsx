import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { H1 } from "@alpic-ai/ui/components/typography";
import { buttonVariants } from "@alpic-ai/ui/components/button";

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
        <a href="/" className={buttonVariants({ variant: "secondary", size: "pill" })}>
          Back to canvas
        </a>
        <div className="space-y-2">
          <H1 className="type-display-xs">{title}</H1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthLoading({ label }: { label: string }) {
  return (
    <AuthShell title="AlpiX">
      <p className="type-text-sm text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </p>
    </AuthShell>
  );
}

export function AuthUnconfigured() {
  return (
    <AuthShell title="Sign-in is not configured">
      <p className="type-text-sm text-muted-foreground">
        Set <code>VITE_DESCOPE_PROJECT_ID</code> and <code>DESCOPE_PROJECT_ID</code> to
        your Descope project ID. The canvas still works without an account.
      </p>
    </AuthShell>
  );
}
