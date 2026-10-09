import { handleMeRequest } from "@alpix/auth";

export default async function handler(req: Request): Promise<Response> {
  const result = await handleMeRequest({
    method: req.method,
    authorization: req.headers.get("authorization"),
  });
  return Response.json(result.body, { status: result.status });
}

export const config = { path: "/api/me" };
