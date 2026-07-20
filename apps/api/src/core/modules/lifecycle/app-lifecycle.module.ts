/**
 * AppLifecycleModule — Provides AppLifecycleService for tracking app state.
 *
 * Imported once by AppModule. The service is @Global() so any module can
 * inject AppLifecycleService to check the current bootstrap phase or
 * subscribe to phase transitions.
 */

import { Global, Module } from '@nestjs/common';
import { AppLifecycleService } from './app-lifecycle.service';

@Global()
@Module({
  providers: [AppLifecycleService],
  exports: [AppLifecycleService],
})
export class AppLifecycleModule {}
