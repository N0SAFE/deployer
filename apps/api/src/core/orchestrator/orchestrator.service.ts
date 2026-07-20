/**
 * OrchestratorService — Event-driven sub-app pipeline manager.
 *
 * Pipeline:
 *   1. db-resolver (headless) — resolves database URL from env/SQLite
 *   2. setup-wizard (HTTP, conditional) — wizard for manual DB config
 *   3. mesh-initializer (HTTP) — discovers DB URL from mesh peers
 *   4. main-app (HTTP, last) — full AppModule with 225+ routes
 *
 * Sub-apps import core modules directly (no forwarded shared providers).
 * Cross-sub-app communication uses bridge classes with static state
 * (BaseTriggerService.sharedStates keyed by bridge class name).
 *
 * Event-driven: uses InitializationService.waitForSetup() (Promise) to
 * know when setup completes — no polling.
 */

import { Injectable, Logger, type INestApplication, type OnApplicationBootstrap } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RouteRegistryService } from "../gateway/route-registry.service";
import { NodeConfigRepository } from "../modules/setup/repositories/node-config.repository";
import { SetupDevModule } from "../setup-dev/setup-dev.module";
import { SetupSubAppModule } from "../setup-sub-app/setup-sub-app.module";
import { runSubApp } from "../sub-app/sub-app-runner";
import { AppModule } from "../../app.module";
import { InternalErrorExceptionFilter } from "../middlewares/internal-error/internal-error-exception.filter";
import { APIErrorExceptionFilter } from "../modules/auth/filters/api-error-exception-filter";
import { SetupWizardBridge } from "../../sub-apps/setup-wizard/setup-wizard.bridge";
import { MeshInitializerBridge } from "../../sub-apps/mesh-initializer/mesh-initializer.bridge";
import { MeshInitializerAppModule } from "../../sub-apps/mesh-initializer/mesh-initializer.app.module";

@Injectable()
export class OrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrchestratorService.name);
  private setupApp: INestApplication | null = null;

  constructor(
    private readonly registry: RouteRegistryService,
    private readonly nodeConfigRepository: NodeConfigRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log("🚀 Orchestrator starting sub-app pipeline…");

    // ── Step 1: Resolve database URL (headless) ──────────────────────────
    await this.runDbResolver();

    // ── Step 2: Check if DB is configured ────────────────────────────────
    const config = this.nodeConfigRepository.find();
    const databaseUrl = config?.databaseUrl?.trim() ?? null;

    if (databaseUrl) {
      this.logger.log("✅ Database already configured — proceeding to mesh-init → main-app");
      this.emitSetupWizardBridge(databaseUrl, config!);
      await this.runMeshInitializer();
      await this.startMainApp();
    } else {
      this.logger.log("⏳ No database — starting setup wizard → event-driven mesh-init → main-app");
      await this.startSetupWizard();
      // Attach listener to InitializationService from the running setup-wizard
      this.waitForSetupAndContinue().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`❌ Orchestration failed: ${msg}`);
      });
    }
  }

  // ─── Bridge: emit to SetupWizardBridge for mesh-init ───────────────

  private emitSetupWizardBridge(databaseUrl: string, config: any): void {
    const bridge = new SetupWizardBridge();
    bridge.emit({
      databaseUrl,
      strategy: config?.strategy ?? "local",
      nodeId: config?.nodeId ?? "unknown",
    });
    bridge.complete();
    this.logger.log("🔗 Emitted to SetupWizardBridge");
  }

  // ─── Step 1: Database URL Resolver (headless) ──────────────────────

  private async runDbResolver(): Promise<void> {
    this.logger.log("⚡ Resolving database URL…");
    try {
      const ctx = await NestFactory.createApplicationContext(SetupDevModule, {
        logger: ["log", "warn", "error"],
      });
      await ctx.close();
      this.logger.log("✅ Database URL resolved");
    } catch (err: unknown) {
      this.logger.warn(`⚠️  DB resolver: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Step 2: Setup Wizard (HTTP, conditional) ──────────────────────

  private async startSetupWizard(): Promise<void> {
    this.logger.log("▶️ Starting setup-wizard (port 3010)…");
    const { app } = await runSubApp(
      { id: "setup-wizard", module: SetupSubAppModule, port: 3010 },
      this.registry,
    );
    this.setupApp = app;
    this.logger.log("✅ Setup wizard running — awaiting event-driven continuation");
  }

  // ─── Step 3: Mesh Initializer ──────────────────────────────────────

  private async runMeshInitializer(): Promise<void> {
    this.logger.log("▶️ Starting mesh-initializer (port 3011)…");
    await runSubApp(
      { id: "mesh-initializer", module: MeshInitializerAppModule, port: 3011, initBeforeExtract: true },
      this.registry,
    );
    // Wait for the bridge (fired when mesh init completes)
    const meshBridge = new MeshInitializerBridge();
    const result = await meshBridge.waitFor();
    this.logger.log(`✅ Mesh init done (strategy=${result.strategy}, meshConnected=${String(result.meshConnected)})`);
  }

  // ─── Event-driven: Setup → Mesh → Main App ────────────────────────

  private async waitForSetupAndContinue(): Promise<void> {
    const { InitializationService } = await import(
      "../modules/setup/services/initialization.service"
    );

    if (!this.setupApp) {
      throw new Error("Setup-wizard app not available");
    }

    // Get the SAME InitializationService from the running setup-wizard's DI
    const initService = this.setupApp.get(InitializationService);
    const status = await initService.waitForSetup();
    this.logger.log(`✅ Setup done (strategy=${status.strategy}) — firing bridge, starting mesh-init`);

    // Emit to SetupWizardBridge so mesh-init picks up the DB URL
    this.emitSetupWizardBridge(status.databaseUrl ?? "", {
      strategy: status.strategy,
      nodeId: status.nodeId,
    });

    await this.runMeshInitializer();
    await this.startMainApp();
  }

  // ─── Step 4: Main App (last, all feature modules) ─────────────────

  private async startMainApp(): Promise<void> {
    this.logger.log("🚀 Launching main-app (AppModule)…");
    const { registration } = await runSubApp(
      {
        id: "main-app", module: AppModule, port: 3012,
        initBeforeExtract: true,
        afterInit: async (subApp, subAppServer) => {
          try {
            subApp.useGlobalFilters(
              subApp.get(APIErrorExceptionFilter),
              subApp.get(InternalErrorExceptionFilter),
            );
          } catch (e: unknown) {
            this.logger.warn(`Filters: ${e instanceof Error ? e.message : String(e)}`);
          }
          subAppServer.get("/openapi.json", async (_req, res) => {
            try {
              const { generateSpec } = await import("../../openapi");
              const spec = await generateSpec();
              res.setHeader("Content-Type", "application/json");
              res.status(200).send(JSON.stringify(spec));
            } catch (err) {
              res.status(500).send({ error: err instanceof Error ? err.message : "Failed" });
            }
          });
          const { apiReference } = await import("@scalar/nestjs-api-reference");
          subAppServer.use("/reference", apiReference({ url: "/openapi.json" }));
        },
      },
      this.registry,
    );
    this.logger.log(`✅ main-app launched — ${registration.routes.length} routes`);
    this.registry.setFallback({ targetUrl: "http://127.0.0.1:3012/", subAppId: "main-app" });
    this.logger.log("🔄 Fallback → main-app");
  }
}
