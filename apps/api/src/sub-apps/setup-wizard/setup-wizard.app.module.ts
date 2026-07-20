/**
 * SetupWizardAppModule — Root module for the setup wizard sub-app context.
 *
 * Core modules import SubAppRunner.forRoot(SetupWizardAppModule, { bridge, ... })
 * which creates an application context from this module. SetupWizardService
 * fires the setup-wizard bridge when initialization is complete, so
 * SubAppRunner can return the result to the waiting core module.
 */

import { Module } from '@nestjs/common';
import { SetupWizardService } from './setup-wizard.service';
import { SetupWizardInitModule } from './setup-wizard-init.module';

@Module({
  imports: [SetupWizardInitModule],
  providers: [
    SetupWizardService,
  ],
})
export class SetupWizardAppModule {}
