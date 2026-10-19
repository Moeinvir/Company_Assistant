/**
 * Fetching a knowledge source from the network.
 *
 * URL documents are fetched by the server, so the guard here matters: a
 * document URL is user-supplied and would otherwise let a workspace make this
 * API issue requests to internal hosts. The rules mirror the provider base-URL
 * guard in `providers/provider-wire.ts` — HTTP(S) only, no embedded
 * credentials, no instance-metadata endpoints — and add a response size cap so
 * one oversized page cannot exhaust the process.
 */

import { htmlToText } from "./html";

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 20_000;

export class SourceFetchError extends Error {}

export function assertSafeSourceUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new SourceFetchError("That is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SourceFetchError("Only HTTP and HTTPS sources are supported.");
  }
  if (url.username || url.password) {
    throw new SourceFetchError("The URL must not contain embedded credentials.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host === "metadata.goog" ||
    /^169\.254\./.test(host)
  ) {
    throw new SourceFetchError("That host is not allowed as a knowledge source.");
  }
  return url;
}

/** Download a URL and return its readable text (HTML is converted). */
export async function fetchSourceText(rawUrl: string): Promise<string> {
  const url = assertSafeSourceUrl(rawUrl);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      redirect: "follow",
      headers: {
        // Identify the crawler and ask for text; many sites vary on this.
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "user-agent": "ParsisBridge/0.1 (+knowledge ingestion)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    throw new SourceFetchError(
      name === "TimeoutError"
        ? "The source did not answer before the request timed out."
        : "The source could not be reached from the API server.",
    );
  }

  if (!response.ok) {
    throw new SourceFetchError(`The source returned HTTP ${response.status}.`);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType && !/text\/|json|xml|html/.test(contentType)) {
    throw new SourceFetchError(
      `That URL serves ${contentType.split(";")[0]}, which cannot be read as text.`,
    );
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BYTES) {
    throw new SourceFetchError("That page is too large to index (over 3 MB).");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new SourceFetchError("That page is too large to index (over 3 MB).");
  }

  const body = new TextDecoder("utf-8").decode(buffer);
  return contentType.includes("html") ? htmlToText(body) : body.trim();
}
