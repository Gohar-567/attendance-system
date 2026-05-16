"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetEmployeePasswordAction } from "@/app/actions/admin";
import { MIN_PASSWORD_LENGTH, validatePassword } from "@/lib/auth/password";

interface Props {
  employeeId: string;
  employeeName: string;
  /** Drives the button label: "Set password" vs "Reset password". */
  authMethod: string;
}

export function ResetPasswordButton({
  employeeId,
  employeeName,
  authMethod,
}: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyHasPassword =
    authMethod === "password" || authMethod === "both";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validity = validatePassword(password);
    if (!validity.ok) {
      setError(validity.error ?? "Invalid password");
      return;
    }

    setPending(true);
    const res = await resetEmployeePasswordAction({
      employeeId,
      newPassword: password,
      forcePasswordChange: forceChange,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Failed");
      return;
    }
    toast.success(`Password ${alreadyHasPassword ? "reset" : "set"} for ${employeeName}`);
    setOpen(false);
    setPassword("");
    setForceChange(true);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4" />
        {alreadyHasPassword ? "Reset password" : "Set password"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setError(null);
            setPassword("");
            setForceChange(true);
          }
        }}
      >
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {alreadyHasPassword ? "Reset" : "Set"} password for {employeeName}
              </DialogTitle>
              <DialogDescription>
                {alreadyHasPassword
                  ? "Issue a new temporary password. Share it with them out-of-band."
                  : "Issue a temporary password so they can sign in without Slack. Share it with them out-of-band."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="reset-temp-password">Temporary password</Label>
              <Input
                id="reset-temp-password"
                type="text"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                required
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={forceChange}
                onChange={(e) => setForceChange(e.target.checked)}
              />
              Force change on next login (recommended)
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !password}>
                {pending ? "Saving…" : "Save password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
