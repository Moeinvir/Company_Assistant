/**
 * CORS origins.
 *
 * Only the browser origins listed in `WEB_ORIGIN` may call the API. The app
 * itself never needs CORS to reach a provider — provider traffic goes through
 * this server — but the SPA does need it to reach the API from its own origin.
 */
export function parseCorsOrigins(value: string | undefined): string[] | false {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : false;
}
