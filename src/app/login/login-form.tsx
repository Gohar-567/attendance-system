"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const errorParam = params.get("error");
  const [slackLoading, setSlackLoading] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSlackLogin() {
    setSlackLoading(true);
    setError(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "slack_oidc",
      options: {
        redirectTo,
        scopes: "openid email profile",
      },
    });
    if (error) {
      setError(error.message);
      setSlackLoading(false);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Email and password are both required");
      return;
    }
    setPwLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(error.message);
      setPwLoading(false);
      return;
    }
    // Middleware will route to /account/change-password if the user is
    // flagged; otherwise the dashboard.
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with Slack or your email + password.
        </p>
      </div>

      <Button
        className="w-full"
        onClick={handleSlackLogin}
        disabled={slackLoading || pwLoading}
      >
        {slackLoading ? "Redirecting…" : "Continue with Slack"}
      </Button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          or
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handlePasswordLogin} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          className="w-full"
          disabled={slackLoading || pwLoading}
        >
          {pwLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {(error || errorParam) && (
        <p className="text-sm text-destructive">
          {error ?? decodeURIComponent(errorParam ?? "")}
        </p>
      )}
    </div>
  );
}
