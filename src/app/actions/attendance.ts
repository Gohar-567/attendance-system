"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/date";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Mark today as WFH (full day) for the current user. Idempotent: upserts
 * on (employee_id, date). Used from the Dashboard's "Log WFH" button.
 */
export async function logWfhTodayAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const date = todayISO();

  const { error } = await supabase
    .from("attendance_logs")
    .upsert(
      {
        employee_id: user.id,
        date,
        type: "wfh",
        half: "full",
        status: "auto_logged",
        source: "web",
        created_by: user.id,
      },
      { onConflict: "employee_id,date" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/history");
  return { ok: true };
}
