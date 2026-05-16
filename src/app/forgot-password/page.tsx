import { Suspense } from "react";

import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Suspense fallback={null}>
        <ForgotPasswordForm />
      </Suspense>
    </main>
  );
}
