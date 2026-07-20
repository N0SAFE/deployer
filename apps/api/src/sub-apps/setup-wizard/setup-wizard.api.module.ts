/**
 * SetupWizardApiModule — Mounts the SetupWizardController on the main Express server.
 *
 * Imported by AppModule so /setup/* ORPC routes are always available
 * directly on the main Express instance.
 */

import { Module } from '@nestjs/common';
import { SetupWizardInitModule } from './setup-wizard-init.module';
import { SetupWizardOrpcModule } from './setup-wizard.orpc.module';
import { SetupWizardController } from './setup-wizard.controller';

@Module({
  imports: [
    SetupWizardInitModule,
    SetupWizardOrpcModule.forRoot(),
  ],
  controllers: [SetupWizardController],
})
export class SetupWizardApiModule {}
