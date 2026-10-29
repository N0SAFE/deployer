import { createHash, timingSafeEqual } from "node:crypto";

import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { MESH_CREDENTIAL_VERIFIER, type MeshCredentialVerifier } from "@deployer/shared/server";

import { parseMeshAgentEnv, type MeshAgentEnv } from "./mesh-agent.env";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compares digests, so the comparison takes the same time whatever the credential's length or content. */
function verifierFor(secret: string): MeshCredentialVerifier {
  const expected = digest(secret);
  return (credential) => credential !== undefined && timingSafeEqual(digest(credential), expected);
}

/**
 * The agent's validated environment, and how a request proves it is a mesh peer. Global because the oRPC host (a
 * sibling of every domain module) injects the verifier.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ validate: (env) => parseMeshAgentEnv(env) as Record<string, unknown>, isGlobal: true })],
  providers: [
    {
      provide: MESH_CREDENTIAL_VERIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<MeshAgentEnv, true>) => verifierFor(config.get("MESH_AGENT_SECRET")),
    },
  ],
  exports: [MESH_CREDENTIAL_VERIFIER, ConfigModule],
})
export class MeshAgentConfigModule {}
