/**
 * SubAppRunner — Starts sub-apps as independent NestJS contexts.
 *
 * ⚠️ NON-BLOCKING DESIGN ⚠️
 *
 * The factory does NOT await bridge.waitFor(). Instead, it starts the sub-app
 * in the background and returns a deferred promise. This prevents the factory
 * from blocking NestFactory.create(), allowing app.init() to register all
 * routes immediately.
 *
 * The sub-app chain runs in the background via OnApplicationBootstrap (started
 * by BootstrapOrchestratorService). When each bridge fires, the deferred
 * promise resolves, making the result available to consumers.
 *
 * Consumers that need the bridge result (e.g. GLOBAL_DATABASE_POOL's LazyPool)
 * call bridge.waitFor() themselves — the bridge is shared via static state, so
 * the same promise resolves regardless of which context calls waitFor().
 *
 * Usage:
 *
 *   @Module({
 *     imports: [
 *       SubAppRunner.forRoot(SetupWizardAppModule, {
 *         imports: [SetupWizardInitModule],
 *       }),
 *     ],
 *     providers: [
 *       {
 *         provide: GLOBAL_DATABASE_POOL,
 *         inject: [SUB_APP_RESULT(SETUP_WIZARD_BRIDGE)],
 *         useFactory: (result: SetupWizardBridgePayload) => {
 *           return new Pool({ connectionString: result.databaseUrl });
 *         },
 *       },
 *     ],
 *   })
 *   class DatabaseModule {}
 *
 * The forRoot() method:
 *   1. Creates a dynamic module that wraps the sub-app module + imported deps
 *   2. Starts the sub-app in the background (fire-and-forget)
 *   3. Returns a deferred promise that resolves when the bridge fires
 *   4. The bridge payload is available for injection via SUB_APP_RESULT(bridge)
 */

import { Module, type DynamicModule, type Type, Logger, Global } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { BaseTriggerService } from '@/core/modules/triggers/base-bridge.service'
import { SUB_APP_RESULT } from './sub-app.constants'
import type { z } from 'zod/v4'

const logger = new Logger('SubAppRunner')

@Module({})
export class SubAppRunner {
    /**
     * Register a sub-app to run during module initialization.
     *
     * The bridge is injected from the main app's DI, then forwarded to the
     * sub-app context via useValue so both contexts share the same instance.
     *
     * ⚠️ NON-BLOCKING: The sub-app starts in the background. The factory
     * returns a deferred promise that resolves when the bridge fires.
     * NestFactory.create() is NOT blocked — routes register immediately.
     *
     * @param subAppModule - The sub-app's root module (e.g., SetupWizardAppModule)
     * @param config.imports - Additional modules the sub-app context needs
     * @param config.bridgeClass - The bridge class (injected from DI)
     * @param config.providers - Additional providers to forward to the sub-app context
     * @param config.timeout - Max time to wait for the sub-app (default 120s)
     */
    static forRoot<T extends BaseTriggerService<z.ZodType>>(
        subAppModule: Type,
        config: {
            bridgeClass: Type<T>
            imports?: Type[]
            providers?: any[]
            /** Additional bridge classes to forward from the main app's DI into the sub-app context */
            forwardBridges?: Type[]
            timeout?: number
        }
    ): DynamicModule {
        const resultToken = SUB_APP_RESULT(config.bridgeClass)
        const timeoutMs = config.timeout
        const injectList: any[] = [config.bridgeClass]
        if (config.forwardBridges) {
            for (const fb of config.forwardBridges) injectList.push(fb)
        }

        return {
            module: SubAppRunner,
            providers: [
                config.bridgeClass,
                ...(config.forwardBridges ?? []),
                {
                    provide: resultToken,
                    useFactory: (...deps: any[]) => {
                        const bridge: T = deps[0]
                        logger.log(`🚀 Starting sub-app (background): ${subAppModule.name}`)

                        // Forward bridge + extra bridges to the sub-app context
                        const hostProviders: any[] = [
                            ...(config.providers ?? []),
                            { provide: config.bridgeClass, useValue: bridge },
                        ]
                        if (config.forwardBridges) {
                            for (let i = 0; i < config.forwardBridges.length; i++) {
                                hostProviders.push({
                                    provide: config.forwardBridges[i],
                                    useValue: deps[i + 1],
                                })
                            }
                        }

                        // Root module: must be @Global() and export forwarded providers
                        // so imported sub-app modules can resolve them.
                        const exportTokens = hostProviders.map((p: any) => p.provide ?? p)
                        @Global()
                        @Module({
                            imports: [...(config.imports ?? []), subAppModule],
                            providers: hostProviders,
                            exports: exportTokens,
                        })
                        class SubAppHostModule {}

                        // ════════════════════════════════════════════════════════════
                        // NON-BLOCKING: Start sub-app in background, return deferred
                        // promise. The factory returns immediately, so NestFactory
                        // .create() completes and app.init() registers all routes.
                        // ════════════════════════════════════════════════════════════
                        const deferredPromise = new Promise<any>((resolve, reject) => {
                            void (async () => {
                                try {
                                    const ctx = await NestFactory.createApplicationContext(
                                        SubAppHostModule,
                                        { abortOnError: false, snapshot: process.env.NODE_ENV !== 'production' },
                                    )

                                    try {
                                        let result: any
                                        if (timeoutMs) {
                                            result = await Promise.race([
                                                bridge.waitFor(),
                                                new Promise<never>((_, rejectTimeout) =>
                                                    setTimeout(() => {
                                                        rejectTimeout(new Error(`Sub-app ${subAppModule.name} timed out after ${String(timeoutMs)}ms`))
                                                    }, timeoutMs),
                                                ),
                                            ])
                                        } else {
                                            result = await bridge.waitFor()
                                        }
                                        logger.log(`✅ Sub-app completed: ${subAppModule.name}`)
                                        resolve(result)
                                    } finally {
                                        await ctx.close().catch(() => { /* ok */ })
                                    }
                                } catch (err) {
                                    const error = err instanceof Error ? err : new Error(String(err))
                                    logger.error(`❌ Sub-app failed: ${subAppModule.name}`, error)
                                    reject(error)
                                }
                            })()
                        })

                        return deferredPromise
                    },
                    inject: injectList,
                },
            ],
            exports: [resultToken],
        }
    }
}
