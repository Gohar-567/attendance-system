"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePassword } from "@/lib/auth/password";
import type {
  ActionResult,
  ChangeOwnPasswordInput,
  CompleteForcedChangeInput,
  ResetPasswordSelfInput,
} from "./types";

/**
 * /settings → "Change password" section.
 * Re-authenticates with the current password, then updates. Clears
 * `must_change_password` so users who forgot they were in forced-change
 * state don't get bounced back to the forced page on next nav.
 */
export async function changeOwnPasswordAction(
  input: ChangeOwnPasswordInput,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "Not signed in" };

  const validity = validatePassword(input.newPassword);
  if (!validity.ok) return validity;

  // Re-auth with current password. Supabase doesn't expose a "verify"
  // primitive; signInWithPassword is the canonical way to confirm it.
  const reauth = await supabase.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (reauth.error) {
    return { ok: false, error: "Current password is wrong" };
  }

  const admin = createAdminClient();
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    password: input.newPassword,
  });
  if (updateErr) return { ok: false, error: updateErr.message };

  await admin
    .from("employees")
    .update({ must_change_password: false })
    .eq("id", user.id);

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "password_changed_by_user",
    target_type: "employee",
    target_id: user.id,
    details: {},
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * /account/change-password — forced flow when must_change_password=true.
 * No current-password check (HR set a temporary one and the user is here
 * to replace it). Clears the flag on success.
 */
export async function completeForcedPasswordChangeAction(
  input: CompleteForcedChangeInput,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const validity = validatePassword(input.newPassword);
  if (!validity.ok) return validity;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: input.newPassword,
  });
  if (error) return { ok: false, error: error.message };

  await admin
    .from("employees")
    .update({ must_change_password: false })
    .eq("id", user.id);

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "password_changed_by_user",
    target_type: "employee",
    target_id: user.id,
    details: { forced: true },
  });

  revalidatePath("/");
  revalidatePath("/me");
  return { ok: true };
}

/**
 * /reset-password — user landed here via the email link from
 * /forgot-password. Supabase's PKCE flow has already given them a
 * temporary "recovery" session; we just update their password and
 * record the audit row.
 */
export async function resetPasswordSelfAction(
  input: ResetPasswordSelfInput,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      error: "Reset link expired or invalid. Request a new one.",
    };
  }

  const validity = validatePassword(input.newPassword);
  if (!validity.ok) return validity;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: input.newPassword,
  });
  if (error) return { ok: false, error: error.message };

  await admin
    .from("employees")
    .update({ must_change_password: false })
    .eq("id", user.id);

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "password_reset_self",
    target_type: "employee",
    target_id: user.id,
    details: {},
  });

  return { ok: true };
}
