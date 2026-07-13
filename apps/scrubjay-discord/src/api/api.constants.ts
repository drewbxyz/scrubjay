import type { Request } from "express";

/** Route prefix shared by every operator-API controller. */
export const API_PREFIX = "api/v1";

/** Leading path segment used by predicates that gate on the operator API. */
export const API_PATH_PREFIX = "/api/";

/**
 * Paths reachable without a bearer token when the API is enabled. The guard is
 * default-closed: only these paths (and API errors' envelope aside) skip auth,
 * so ANY new public route MUST be added here explicitly. Stored lowercased and
 * matched case-insensitively because Express routes case-insensitively.
 */
export const PUBLIC_PATHS = ["/health"] as const;

/**
 * The request path used by the guard/filter predicates: query string stripped
 * and lowercased. Express matches routes case-insensitively, so predicates that
 * gate on the path must normalize the same way or a case variant (`/API/...`)
 * slips past them. `originalUrl` wins over `url` (it survives router mounting).
 */
export function requestPathname(request: Request): string {
  return (request.originalUrl ?? request.url ?? "").split("?")[0].toLowerCase();
}

/** True when `pathname` (already normalized) is an allowlisted public path. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (allowed) => pathname === allowed || pathname === `${allowed}/`,
  );
}
