/**
 * What happens to an image's scan lifecycle when the image is seen alive. Pure, so the three outcomes (first
 * sight, back after a delete, still here) are tested without a database.
 */
export type ExistingLifecycle = {
  readonly currentGeneration: number;
  readonly lifecycleState: string;
};

export type LifecyclePlan =
  | { readonly action: "create"; readonly generation: 1; readonly event: "image_created" }
  | { readonly action: "revive"; readonly generation: number; readonly event: "image_revived" }
  | { readonly action: "touch"; readonly generation: number; readonly event: null };

export function planAliveLifecycle(existing: ExistingLifecycle | null): LifecyclePlan {
  if (existing === null) {
    return { action: "create", generation: 1, event: "image_created" };
  }
  if (existing.lifecycleState === "deleted") {
    // A deleted image that comes back is a new generation: scans of the old one must not be reused.
    return { action: "revive", generation: existing.currentGeneration + 1, event: "image_revived" };
  }
  return { action: "touch", generation: existing.currentGeneration, event: null };
}
