"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface UpdatePrefsInput {
  digest_enabled: boolean;
  nudge_enabled: boolean;
}

export async function updateNotificationPrefsAction(
  input: UpdatePrefsInput,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // RLS policy `employees_self_update` allows owners to edit their row.
  const { error } = await supabase
    .from("employees")
    .update({
      digest_enabled: input.digest_enabled,
      nudge_enabled: input.nudge_enabled,
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}
