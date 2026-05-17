"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { sendMagicLinkAction } from "@/app/actions/auth";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const errorParam = params.get("error");

  // Slack OAuth
  const [slackLoading, setSlackLoading] = useState(false);

  // Email + password
  const [pwLoading, setPwLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Magic link
  const [magicEmail, setMagicEmail] = useState("");
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

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
    router.replace("/");
    router.refresh();
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!magicEmail) {
      setError("Enter your email to get a magic link");
      return;
    }
    setMagicLoading(true);
    const res = await sendMagicLinkAction({ email: magicEmail });
    setMagicLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't send link");
      return;
    }
    // Generic success — don't reveal whether the address is registered.
    setMagicSent(true);
  }

  const anyLoading = slackLoading || pwLoading || magicLoading;

  return (
    <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with Slack, your password, or a one-time magic link.
        </p>
      </div>

      {/* 1. Slack OAuth — primary */}
      <Button
        className="w-full"
        onClick={handleSlackLogin}
        disabled={anyLoading}
      >
        {slackLoading ? "Redirecting…" : "Continue with Slack"}
      </Button>

      <Divider label="or" />

      {/* 2. Email + password */}
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
          disabled={anyLoading}
        >
          {pwLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <Divider label="or get a magic link" />

      {/* 3. Magic link */}
      {magicSent ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-900 dark:text-emerald-200">
          If your email is registered, you&apos;ll get a link shortly. The
          link expires in 1 hour.
          <button
            type="button"
            onClick={() => {
              setMagicSent(false);
              setMagicEmail("");
            }}
            className="mt-2 block text-xs underline-offset-2 hover:underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleMagicLink} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="magic-email">Email</Label>
            <Input
              id="magic-email"
              type="email"
              autoComplete="email"
              value={magicEmail}
              onChange={(e) => setMagicEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <Button
            type="submit"
            variant="ghost"
            className="w-full"
            disabled={anyLoading || !magicEmail}
          >
            {magicLoading ? "Sending…" : "Send magic link"}
          </Button>
        </form>
      )}

      {(error || errorParam) && (
        <p className="text-sm text-destructive">
          {error ?? decodeURIComponent(errorParam ?? "")}
        </p>
      )}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
