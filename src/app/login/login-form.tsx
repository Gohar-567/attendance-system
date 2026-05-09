"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const errorParam = params.get("error");

  async function handleSlackLogin() {
    setLoading(true);
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
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with your Slack account to continue.
        </p>
      </div>

      <Button className="w-full" onClick={handleSlackLogin} disabled={loading}>
        {loading ? "Redirecting…" : "Continue with Slack"}
      </Button>

      {(error || errorParam) && (
        <p className="mt-4 text-sm text-destructive">
          {error ?? decodeURIComponent(errorParam ?? "")}
        </p>
      )}
    </div>
  );
}
