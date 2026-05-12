"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({
  variant = "ghost",
  size = "sm",
  className,
}: {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSignOut}
      disabled={loading}
      className={className}
    >
      {loading ? "Signing out…" : "Sign out"}
    </Button>
  );
}
