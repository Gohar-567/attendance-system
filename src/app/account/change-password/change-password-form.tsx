"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeForcedPasswordChangeAction } from "@/app/actions/auth";
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "@/lib/auth/password";

export function ChangePasswordForm() {
  const router = useRouter();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const res = await completeForcedPasswordChangeAction({ newPassword: next });
    if (!res.ok) {
      setError(res.error ?? "Couldn't save");
      setPending(false);
      return;
    }
    toast.success("Password updated");
    router.replace("/me");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="forced-new">New password</Label>
        <Input
          id="forced-new"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="forced-confirm">Confirm password</Label>
        <Input
          id="forced-confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Min {MIN_PASSWORD_LENGTH} characters. Avoid obvious phrases like
        &quot;password123&quot;.
      </p>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save and continue"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
