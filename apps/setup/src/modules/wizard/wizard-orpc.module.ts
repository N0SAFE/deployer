import { Module, type DynamicModule } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { ORPCModule } from "@orpc/nest";
import { os } from "@orpc/server";

/**
 * The setup app's ORPC context.
 *
 * Deliberately EMPTY of auth: setup runs before any account exists, so there is
 * no session to load and no auth service to construct. That is the whole reason
 * this app has its own module instead of reusing the API's — the API's factory
 * injects `AuthCoreService` (which needs the global Postgres, a database that
 * does not exist yet at this point).
 *
 * `request` is carried because the wizard's handlers need the caller's host to
 * decide where to send the browser after setup.
 */
export type WizardContext = {
  request: Request;
  [key: string]: unknown;
  [key: symbol]: unknown;
};

/** The `os` builder for setup handlers: it declares the context they receive. */
export const wizardOs = os.$context<WizardContext>();

@Module({})
export class WizardOrpcModule {
  static forRoot(): DynamicModule {
    return {
      module: WizardOrpcModule,
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
