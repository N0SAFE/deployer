"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ScanSearch, Bell, Globe, Cog } from "lucide-react";
import { AuthDashboardNodes, AuthDashboardProjects, AuthDashboardSettingsAccount } from "@/routes";
import { SETUP_COMPLETE_KEY } from "./setup-storage";

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
            router.push(AuthDashboardProjects());
            next("configured");
          },
        },
        cancel: {
          label: "Skip",
          onClick: () => { next("dismissed"); },
        },
        onDismiss: () => { next("skipped"); },
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
        action: { label: "Configure", onClick: () => { router.push(AuthDashboardSettingsAccount()); next("configured"); } },
        cancel: { label: "Skip", onClick: () => { next("dismissed"); } },
        onDismiss: () => { next("skipped"); },
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
        action: { label: "Set up", onClick: () => { router.push(AuthDashboardProjects()); next("configured"); } },
        cancel: { label: "Later", onClick: () => { next("dismissed"); } },
        onDismiss: () => { next("skipped"); },
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
        action: { label: "Add nodes", onClick: () => { router.push(AuthDashboardNodes()); next("configured"); } },
        cancel: { label: "Not now", onClick: () => { next("dismissed"); } },
        onDismiss: () => { next("skipped"); },
      });
    },
  },
];

const LS_DISMISSED_SET = "post-setup-dismissed-set";

function readDismissed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_DISMISSED_SET) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberDismissed(hintId: string): void {
  try {
    const set = readDismissed();
    set.add(hintId);
    localStorage.setItem(LS_DISMISSED_SET, JSON.stringify([...set]));
  } catch { /* storage unavailable: the hint may show again, nothing else is lost */ }
}

// ─── Component ──────────────────────────────────────────────────────────

export function PostSetupHints() {
  const router = useRouter();
  const started = useRef(false);

  // One-shot sequential queue: show a hint, and when it is answered move on to the
  // next hint that was not already dismissed. Driven by the toast callbacks, so no
  // component state is involved.
  useEffect(() => {
    if (started.current) return;
    if (!localStorage.getItem(SETUP_COMPLETE_KEY)) return;
    started.current = true;
    localStorage.removeItem(SETUP_COMPLETE_KEY);

    const dismissed = readDismissed();
    const runFrom = (index: number): void => {
      for (let i = index; i < HINTS.length; i++) {
        const hint = HINTS[i];
        if (!hint || dismissed.has(hint.id)) continue;
        hint.run((result) => {
          if (result !== "skipped") rememberDismissed(hint.id);
          runFrom(i + 1);
        }, router);
        return;
      }
    };
    runFrom(0);
  }, [router]);

  return null;
}
