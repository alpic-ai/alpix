import type { FormHTMLAttributes, InputHTMLAttributes } from "react";

export type WebMcpSubmitEvent = SubmitEvent & {
  agentInvoked?: boolean;
  respondWith?(result: Promise<unknown>): void;
};

declare module "react" {
  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: boolean;
  }

  interface InputHTMLAttributes<T> {
    toolparamdescription?: string;
  }
}

/** Extra props the Alpic Input types were compiled without. */
export const displayNameToolParam = {
  toolparamdescription:
    "A short public nickname (max 40 characters) used to attribute drawings on the shared canvas.",
} satisfies InputHTMLAttributes<HTMLInputElement>;

export const nameFormToolAttrs = {
  toolname: "set-display-name",
  tooldescription:
    "Set the viewer's display name on AlpiX. Call this first when no name is chosen yet. After it succeeds, stamp-grid becomes available for drawing on the canvas.",
  toolautosubmit: true,
} satisfies FormHTMLAttributes<HTMLFormElement>;
