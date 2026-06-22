import type { INestApplication } from "@nestjs/common";
import type { ContractRouterClient } from "@orpc/contract";
import type { setupContract } from "@repo/api-contracts";
import type request from 'supertest'
import type { App } from "supertest/types";
import { getSharedApiRuntimeContext } from "@/e2e/utils/shared-api-runtime";

export interface SetupWorkflowContext {
  app: INestApplication<App>;
  databaseUrl: string;
  baseUrl: string;
  http: ReturnType<typeof request>
  orpc: ContractRouterClient<typeof setupContract>;
}

export async function createSetupWorkflowContext(): Promise<SetupWorkflowContext> {
  const context = await getSharedApiRuntimeContext();

  return {
    app: context.runtime.app,
    databaseUrl: context.runtime.databaseUrl,
    baseUrl: context.runtime.baseUrl,
    http: context.http,
    orpc: context.orpc.setup,
  };
}
