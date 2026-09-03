/**
 * @repo/nest-lifecycle — NestJS application lifecycle tracking
 *
 * Provides AppLifecycleService for tracking bootstrap phases and
 * AppLifecycleModule for wiring it into your NestJS application.
 *
 * ## Usage
 *
 * ```typescript
 * // In your root module
 * import { AppLifecycleModule } from "@repo/nest-lifecycle"
 *
 * @Module({ imports: [AppLifecycleModule] })
 * export class AppModule {}
 *
 * // In any service
 * import { AppLifecycleService, AppLifecyclePhase } from "@repo/nest-lifecycle"
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

export { AppLifecycleModule } from './app-lifecycle.module';
export {
  AppLifecycleService,
  AppLifecyclePhase,
  BootstrapStep,
} from './app-lifecycle.service';
export type { AppLifecycleEvent } from './app-lifecycle.service';
