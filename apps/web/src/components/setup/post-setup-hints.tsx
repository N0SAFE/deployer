"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ScanSearch, Bell, Globe, Cog } from "lucide-react";
import { AuthDashboardAdminSystem } from "@/routes";
import { setupEndpoints } from "@/domains/setup/endpoints";

// ─── Hint definitions with fully custom run() logic ─────────────────────

type HintResult = "dismissed" | "configured" | "skipped";

interface HintDef {
  id: string;
  icon: React.ReactNode;
  run: (next: (result: HintResult) => void, router: ReturnType<typeof useRouter>) => void;
}

const HINTS: HintDef[] = [
  {
    id: "scanning",
    icon: <ScanSearch className="h-4 w-4" />,
    run(next, router) {
      toast("Configure image scanning?", {
        description:
          "Enable automatic vulnerability scanning for new container images. You can configure per-project filters.",
        duration: 20_000,
        position: "bottom-right",
        icon: <ScanSearch className="h-4 w-4" />,
        action: {
          label: "Configure",
          onClick: () => {
            router.push("/dashboard/projects");
            next("configured");
          },
        },
        cancel: {
          label: "Skip",
          onClick: () => next("dismissed"),
        },
        onDismiss: () => next("skipped"),
      });
    },
  },
  {
    id: "notifications",
    icon: <Bell className="h-4 w-4" />,
    run(next, router) {
      toast("Set up notification channels?", {
        description: "Get alerted via email or webhook on deployment status changes, new scan findings, and mesh health events.",
        duration: 20_000,
        position: "bottom-right",
        icon: <Bell className="h-4 w-4" />,
        action: { label: "Configure", onClick: () => { router.push("/dashboard/profile"); next("configured"); } },
        cancel: { label: "Skip", onClick: () => next("dismissed") },
        onDismiss: () => next("skipped"),
      });
    },
  },
  {
    id: "domain",
    icon: <Globe className="h-4 w-4" />,
    run(next, router) {
      toast("Claim a custom domain?", {
        description: "Point your own domain to the platform. Supports automatic SSL via Let's Encrypt.",
        duration: 20_000,
        position: "bottom-right",
        icon: <Globe className="h-4 w-4" />,
        action: { label: "Set up", onClick: () => { router.push("/dashboard/projects"); next("configured"); } },
        cancel: { label: "Later", onClick: () => next("dismissed") },
        onDismiss: () => next("skipped"),
      });
    },
  },
  {
    id: "fleet",
    icon: <Cog className="h-4 w-4" />,
    run(next, router) {
      toast("Add worker nodes?", {
        description: "Scale your mesh by adding remote nodes. Workers handle deployments and can be located anywhere.",
        duration: 20_000,
        position: "bottom-right",
        icon: <Cog className="h-4 w-4" />,
        action: { label: "Add nodes", onClick: () => { router.push("/dashboard/fleet"); next("configured"); } },
        cancel: { label: "Not now", onClick: () => next("dismissed") },
        onDismiss: () => next("skipped"),
      });
    },
  },
];

const LS_FLAG = "post-setup-complete";
const LS_DISMISSED_SET = "post-setup-dismissed-set";

// ─── Component ──────────────────────────────────────────────────────────

export function PostSetupHints() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const done = useRef(false);
  const idx = useRef(0);

  const next = useCallback((hintId: string, result: HintResult) => {
    if (result !== "skipped") {
      try {
        const set = new Set(JSON.parse(localStorage.getItem(LS_DISMISSED_SET) ?? "[]"));
        set.add(hintId);
        localStorage.setItem(LS_DISMISSED_SET, JSON.stringify([...set]));
      } catch { /* noop */ }
    }
    setRunning(false);
  }, []);

  useEffect(() => {
    if (done.current) return;
    const setupDone = localStorage.getItem(LS_FLAG);
    if (!setupDone) return;
    done.current = true;
    localStorage.removeItem(LS_FLAG);
    setRunning(true);
  }, []);

  // Sequential queue: when running becomes false, start next non-dismissed hint
  useEffect(() => {
    if (!running) return;

    const dismissed: string[] = JSON.parse(
      localStorage.getItem(LS_DISMISSED_SET) ?? "[]"
    );

    while (idx.current < HINTS.length) {
      const hint = HINTS[idx.current];
      idx.current++;
      if (!hint || dismissed.includes(hint.id)) continue;
      hint.run((result) => next(hint.id, result), router);
      return;
    }
  }, [running, next, router]);

  return null;
}
