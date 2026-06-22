"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@repo/ui/components/shadcn/card";
import { Alert, AlertDescription } from "@repo/ui/components/shadcn/alert";
import { Button } from "@repo/ui/components/shadcn/button";
import { Spinner } from "@repo/ui/components/atomics/atoms/Icon";
import { Setup, AuthSignin } from "@/routes";
import { useSetupState } from "@/domains/setup/hooks";
import { SetupWizard } from "@/components/setup/setup-wizard";

// ─── Loading ──────────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h2 className="text-xl font-semibold">Unable to check setup status</h2>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
          <Button className="mt-4 w-full" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default Setup.Route(({ searchParams }) => {
  const router = useRouter();
  const { data: setupState, isLoading, isError, error, refetch } = useSetupState();
  const redirectTo = searchParams.redirectTo ?? searchParams.callbackUrl;

  // Redirect to sign-in if setup is already complete
  React.useEffect(() => {
    if (setupState && !setupState.needsSetup) {
      router.replace(AuthSignin({}, { redirectTo }));
    }
  }, [setupState, router, redirectTo]);

  // Loading
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Error fetching setup state
  if (isError) {
    return <ErrorScreen message={error?.message ?? "Unknown error"} onRetry={() => refetch()} />;
  }

  // Setup already done — redirecting (will flash loading briefly)
  if (setupState && !setupState.needsSetup) {
    return <LoadingScreen />;
  }

  // Needs setup — render the wizard
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <SetupWizard />
      </div>
    </div>
  );
});
