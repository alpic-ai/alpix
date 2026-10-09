import { handleSessionRequest } from "@alpix/auth";

export default function handler(request: Request): Promise<Response> {
  return handleSessionRequest(request);
}

export const config = {
  path: "/api/session",
};
