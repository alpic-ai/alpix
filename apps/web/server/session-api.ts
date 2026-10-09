import type { Connect } from "vite";
import { handleMeRequest } from "@alpix/auth";

function sendJson(
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  },
  status: number,
  body: unknown,
) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/** Dev and preview handler for GET /api/me. Production uses the Netlify function. */
export function createDescopeSessionMiddleware(
  env: Record<string, string | undefined> = process.env,
): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (path !== "/api/me") {
      next();
      return;
    }

    void handleMeRequest(
      {
        method: req.method,
        authorization: req.headers.authorization,
      },
      { env },
    )
      .then((result) => {
        sendJson(res, result.status, result.body);
      })
      .catch(() => {
        sendJson(res, 500, { error: "Session validation failed." });
      });
  };
}
