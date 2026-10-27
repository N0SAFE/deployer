/**
 * @deployer/nest-lifecycle — NestJS application lifecycle tracking
 *
 * Provides AppLifecycleService for tracking bootstrap phases and
 * AppLifecycleModule for wiring it into your NestJS application.
 *
 * ## Usage
 *
 * ```typescript
 * // In your root module
 * import { AppLifecycleModule } from "@deployer/nest-lifecycle"
 *
 * @Module({ imports: [AppLifecycleModule] })
 * export class AppModule {}
 *
 * // In any service
 * import { AppLifecycleService, AppLifecyclePhase } from "@deployer/nest-lifecycle"
 *
 * @Injectable()
 * class MyService {
 *   constructor(private readonly lifecycle: AppLifecycleService) {
 *     this.lifecycle.events$.subscribe(event => {
 *       if (event.phase === AppLifecyclePhase.READY) {
 *         // app is ready
 *       }
 *     })
 *   }
 * }
 * ```
 */

export { AppLifecycleModule } from '@deployer/nest-lifecycle/app-lifecycle.module';
export {
  AppLifecycleService,
  AppLifecyclePhase,
  BootstrapStep,
} from '@deployer/nest-lifecycle/app-lifecycle.service';
export type { AppLifecycleEvent } from '@deployer/nest-lifecycle/app-lifecycle.service';
