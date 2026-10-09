import { handleMeRequest } from "@alpix/auth";

type SessionRequest = {
  method?: string;
  headers: { authorization?: string | string[] | undefined };
};

type SessionResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

/** Express handler mounted at GET /api/me. Validates the Descope session JWT. */
export function descopeSessionRoute(req: SessionRequest, res: SessionResponse): void {
  const header = req.headers.authorization;
  const authorization = typeof header === "string" ? header : undefined;
  void handleMeRequest({ method: req.method, authorization })
    .then((result) => {
      res.status(result.status).json(result.body);
    })
    .catch(() => {
      res.status(500).json({ error: "Session validation failed." });
    });
}
