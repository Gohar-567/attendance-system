"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPasswordAction } from "@/app/actions/auth";
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "@/lib/auth/password";

export function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New password doesn't match the confirmation");
      return;
    }
    const validity = validatePassword(next);
    if (!validity.ok) {
      setError(validity.error ?? "Invalid password");
      return;
    }

    setPending(true);
    const res = await changeOwnPasswordAction({
      currentPassword,
      newPassword: next,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save");
      return;
    }
    toast.success("Password updated");
    setCurrentPassword("");
    setNext("");
    setConfirm("");
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Change password
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Verifies your current password before saving.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={pending || !currentPassword || !next || !confirm}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
