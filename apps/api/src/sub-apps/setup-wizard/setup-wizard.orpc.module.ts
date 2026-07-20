import { Module, type DynamicModule } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { ORPCModule } from '@orpc/nest';
import { os } from '@orpc/server';

export type SubAppContext = Record<string, never>;
export const subOs = os.$context<SubAppContext>();

@Module({})
export class SetupWizardOrpcModule {
  static forRoot(): DynamicModule {
    return {
      module: SetupWizardOrpcModule,
      imports: [
        ORPCModule.forRootAsync({
          inject: [REQUEST],
          useFactory: (request: Request) => ({
            context: { request },
          }),
        }),
      ],
    };
  }
}
