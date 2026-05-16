"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-8 shadow-sm">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Forgot your password?
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your work email and we&apos;ll send a reset link.
        </p>
      </div>

      {sent ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-900 dark:text-emerald-200">
            Check your inbox at <strong>{email}</strong>. The link is valid for
            an hour.
          </p>
          <Link
            href="/login"
            className="block text-center text-sm font-medium underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending || !email}>
            {pending ? "Sending…" : "Send reset link"}
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
