"use client";

import { Button } from "@deployer/ui/components/shadcn/button";
import { WifiOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div role="status" className="text-center">
        <div className="bg-muted mx-auto mb-6 flex size-16 items-center justify-center rounded-full">
          <WifiOff className="text-muted-foreground size-8" aria-hidden />
        </div>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="text-muted-foreground mx-auto mb-6 max-w-md text-sm">
          This device has no connection to the network, so the dashboard cannot reach your
          Deployer server. Pages you already opened may still show old data. Reconnect and try again.
        </p>
        <Button
          onClick={() => {
            window.location.reload();
          }}
          className="inline-flex items-center gap-2"
        >
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    </div>
  );
}
