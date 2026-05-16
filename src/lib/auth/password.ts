/**
 * Password rules used by every HR-issues-a-password + user-changes-password
 * code path. Shared by server actions and client forms (live feedback).
 *
 * Min length: 8.
 * Denylist: small set of obvious passwords. Not a full strength check —
 * Supabase Auth's built-in throttling handles the brute-force angle; this
 * is a sanity guard so HR can't ship "password" as someone's temp password.
 */

export const MIN_PASSWORD_LENGTH = 8;

const DENYLIST = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "abc12345",
  "letmein",
  "welcome",
  "welcome1",
  "welcome123",
  "admin",
  "administrator",
  "iloveyou",
  "monkey123",
]);

export interface PasswordCheck {
  ok: boolean;
  error?: string;
}

export function validatePassword(raw: string): PasswordCheck {
  if (typeof raw !== "string") {
    return { ok: false, error: "Password is required" };
  }
  const p = raw;
  if (p.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  if (p.length > 72) {
    // bcrypt truncates beyond 72; reject so the user knows.
    return { ok: false, error: "Password is too long (max 72)" };
  }
  if (DENYLIST.has(p.toLowerCase())) {
    return { ok: false, error: "That password is too common — pick another" };
  }
  return { ok: true };
}

/** Convenience: does this auth_method include password sign-in? */
export function hasPasswordAuth(authMethod: string | null | undefined): boolean {
  return authMethod === "password" || authMethod === "both";
}
