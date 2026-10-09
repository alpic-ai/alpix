export {
  DEFAULT_DESCOPE_FLOW_ID,
  MISSING_DESCOPE_PROJECT_ID,
  publicDescopeConfig,
  type PublicDescopeConfig,
} from "./public-config.js";
export {
  DescopeConfigError,
  readDescopeBaseUrl,
  readDescopeProjectId,
  readSessionAudience,
  type Env,
} from "./config.js";
export { bearerToken } from "./bearer.js";
export { sessionUserFromToken, type SessionUser } from "./user.js";
export {
  authorizeSession,
  handleSessionRequest,
  SessionUnauthorizedError,
  type SessionHandlerOptions,
} from "./http.js";
export { createDescopeClient, type ValidateSession } from "./client.js";
