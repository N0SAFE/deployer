/**
 * Reading a container's engine description: its image layers, the watch tool it runs under and its healthcheck
 * timings. Pure functions over engine output, tested without a daemon.
 */
import type { DockerContainerInspectDetail } from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

export function extractRootFsLayers(source: unknown): string[] {
  if (!isRecord(source)) {
    return [];
  }

  const rootFsCandidate = (() => {
    if (isRecord(source.RootFS)) {
      return source.RootFS;
    }

    if (isRecord(source.RootFs)) {
      return source.RootFs;
    }

    return null;
  })();

  if (!rootFsCandidate) {
    return [];
  }

  const layersValue = rootFsCandidate.Layers ?? rootFsCandidate.layers;
  if (Array.isArray(layersValue)) {
    return layersValue.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }

  if (typeof layersValue === "string" && layersValue.length > 0) {
    return [layersValue];
  }

  return [];
}

export function detectWatchModeFromLabels(labels: Record<string, string>):
  DockerContainerInspectDetail["runtimeConfig"]["watchMode"] {
  const normalizedValues = Object.values(labels).map((value) => value.toLowerCase());
  const normalizedKeys = Object.keys(labels).map((key) => key.toLowerCase());

  const has = (needle: string) =>
    normalizedValues.some((value) => value.includes(needle))
    || normalizedKeys.some((value) => value.includes(needle));

  if (has("nodemon")) return "nodemon";
  if (has("watchpack")) return "watchpack";
  if (has("vite")) return "vite";
  if (has("turbo")) return "turbo";
  if (has("watch")) return "custom";

  return "disabled";
}

export function toHealthcheckSeconds(value: number | undefined): number | null {
  if (typeof value !== "number" || value <= 0) {
    return null;
  }

  return Math.max(1, Math.round(value / 1_000_000_000));
}
