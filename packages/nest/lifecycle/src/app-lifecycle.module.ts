/**
 * AppLifecycleModule — Provides AppLifecycleService for tracking app state.
 *
 * REGISTER WITH `forRoot()`, NOT A BARE IMPORT.
 * It takes no options — the lifecycle state is inherently per-process and has
 * nothing to configure. The method exists so every shared NestJS module in this
 * repo is registered the same way, which is what makes a wiring mistake
 * visible.
 *
 * The service is `@Global()` so any module can inject `AppLifecycleService` to
 * read the current bootstrap phase or subscribe to its transitions.
 */

import { Global, Module, type DynamicModule } from '@nestjs/common';
import { AppLifecycleService } from '@repo/nest-lifecycle/app-lifecycle.service';

@Global()
@Module({})
export class AppLifecycleModule {
  static forRoot(): DynamicModule {
    return {
      module: AppLifecycleModule,
      providers: [AppLifecycleService],
      exports: [AppLifecycleService],
    };
  }
}
