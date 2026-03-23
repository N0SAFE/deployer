"use client";

import { useEffect, useMemo, useState } from "react";
import type { MeshRuntimeEvent } from "@repo/api-contracts/common/mesh";

type MeshStreamStatus = "connecting" | "connected" | "disconnected" | "error";

export function useMeshSseState() {
  const apiBaseUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "";
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }, []);

  const isConfigured = apiBaseUrl.length > 0;

  const [status, setStatus] = useState<MeshStreamStatus>(isConfigured ? "connecting" : "error");
  const [lastError, setLastError] = useState<string | null>(
    isConfigured ? null : "NEXT_PUBLIC_API_URL is not configured",
  );
  const [state, setState] = useState<MeshRuntimeEvent | null>(null);

  useEffect(() => {
    if (!isConfigured) {
      return;
    }

    const source = new EventSource(`${apiBaseUrl}/system/mesh/events`, {
      withCredentials: true,
    });

    const onOpen = () => {
      setStatus("connected");
      setLastError(null);
    };

    const onMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as MeshRuntimeEvent;
        setState(parsed);
        setStatus("connected");
      } catch {
        setLastError("Failed to parse mesh SSE payload");
        setStatus("error");
      }
    };

    const onError = () => {
      setStatus("error");
      setLastError("Mesh SSE connection error");
    };

    source.addEventListener("open", onOpen);
    source.addEventListener("mesh-state", onMessage as EventListener);
    source.addEventListener("error", onError);

    return () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("mesh-state", onMessage as EventListener);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [apiBaseUrl, isConfigured]);

  return {
    status,
    lastError,
    state,
  };
}