/**
 * SubAppResultStore — Shared mutable store for sub-app bridge results.
 *
 * Sub-apps run BEFORE NestFactory.create() in main.ts. Their results
 * (database URL, node ID, etc.) are stored here so that the main NestJS
 * app's providers (e.g. GLOBAL_DATABASE_POOL) can read them synchronously
 * without blocking on bridge.waitFor().
 *
 * Usage:
 *
 *   // main.ts — before NestFactory.create()
 *   const meshResult = await runMeshSubApp()
 *   SubAppResultStore.set(MeshInitializerBridge, meshResult)
 *
 *   // global-database.module.ts — during NestFactory.create()
 *   const result = SubAppResultStore.get(MeshInitializerBridge)
 *   // result is immediately available, no blocking
 */

import type { BaseTriggerService } from '@/core/modules/triggers/base-bridge.service'
import type { z } from 'zod/v4'

const store = new Map<string, unknown>()

export const SubAppResultStore = {
  /**
   * Store a sub-app result keyed by its bridge class.
   */
  set<T extends BaseTriggerService<z.ZodType>>(
    bridgeClass: { new (...args: any[]): T },
    result: unknown,
  ): void {
    store.set(bridgeClass.name, result)
  },

  /**
   * Retrieve a sub-app result. Returns null if the sub-app hasn't completed.
   */
  get<T>(bridgeClass: { new (...args: any[]): any }): T | null {
    return (store.get(bridgeClass.name) as T) ?? null
  },

  /**
   * Check if a sub-app result is available.
   */
  has(bridgeClass: { new (...args: any[]): any }): boolean {
    return store.has(bridgeClass.name)
  },
}