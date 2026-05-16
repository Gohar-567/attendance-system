"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordSelfAction } from "@/app/actions/auth";
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "@/lib/auth/password";

export function ResetPasswordForm() {
  const router = useRouter();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError("Passwords don't match");
      return;
    }
    const validity = validatePassword(next);
    if (!validity.ok) {
      setError(validity.error ?? "Invalid password");
      return;
    }

    setPending(true);
    const res = await resetPasswordSelfAction({ newPassword: next });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't reset password");
      return;
    }
    setDone(true);
    // Small delay so the user actually sees the success message.
    setTimeout(() => {
      router.replace("/me");
      router.refresh();
    }, 1200);
  }

  return (
    <div className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-8 shadow-sm">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="text-sm text-muted-foreground">
          Min {MIN_PASSWORD_LENGTH} characters. Avoid obvious phrases.
        </p>
      </div>

      {done ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-200">
          Password updated. Redirecting…
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset-new">New password</Label>
            <Input
              id="reset-new"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={pending || !next || !confirm}
          >
            {pending ? "Saving…" : "Save new password"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Link
            href="/login"
            className="block text-center text-xs text-muted-foreground hover:underline"
          >
            Cancel and go back
          </Link>
        </form>
      )}
    </div>
  );
}
