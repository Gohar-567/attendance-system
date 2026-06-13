/**
 * Canonical app URL. Used by every Slack DM link, cron-side notification
 * link, and password-reset / magic-link redirectTo.
 *
 * Rules:
 *   - In production, NEXT_PUBLIC_APP_URL is the source of truth.
 *   - If NEXT_PUBLIC_APP_URL is missing OR set to localhost while we're
 *     running in production, we fall back to the hardcoded prod URL so
 *     bot links never send users to whatever's running on the recipient's
 *     own port 3000.
 *   - In development, NEXT_PUBLIC_APP_URL wins if set; otherwise
 *     http://localhost:3000.
 *
 * Trailing slashes are stripped — callers should do `${appUrl}/history`
 * etc. without worrying about double slashes.
 */
const FALLBACK_PRODUCTION_URL = "https://attendance-system-drab-ten.vercel.app";
const DEV_FALLBACK = "http://localhost:3000";

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const env = raw?.replace(/\/+$/, "");

  if (env && env.length > 0) {
    if (isProd() && env.includes("localhost")) {
      // Misconfigured Vercel env var — refuse to ship localhost links.
      return FALLBACK_PRODUCTION_URL;
    }
    return env;
  }
  return isProd() ? FALLBACK_PRODUCTION_URL : DEV_FALLBACK;
}
