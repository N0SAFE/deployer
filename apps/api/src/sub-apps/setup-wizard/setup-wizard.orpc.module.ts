import { Module, type DynamicModule } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { ORPCModule } from '@orpc/nest';
import { os } from '@orpc/server';
import { AuthCoreService } from '@/core/modules/auth/services/auth-core.service';

export type SubAppContext = { auth?: unknown; [key: string]: unknown; [key: symbol]: unknown };
export const subOs = os.$context<SubAppContext>();

@Module({})
export class SetupWizardOrpcModule {
  static forRoot(): DynamicModule {
    return {
      module: SetupWizardOrpcModule,
      imports: [
        ORPCModule.forRootAsync({
          inject: [REQUEST, AuthCoreService],
          useFactory: (request: Request, authCoreService: AuthCoreService) => ({
            context: { request, auth: authCoreService.createEmptyAuthUtils() },
          }),
        }),
      ],
    };
  }
}
