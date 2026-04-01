import { Command, CommandRunner } from 'nest-commander';
import { Inject, Injectable } from '@nestjs/common';
import { EnvService } from '@/config/env/env.service';
import { asc, eq } from 'drizzle-orm';
import * as schema from '@/config/drizzle/global/schema';
import { DATABASE_SERVICE, ENV_SERVICE } from '../tokens';
import { GlobalDatabaseService } from '@/core/modules/database/services/global-database.service';

const UUID_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_CLUSTER_ID = '00000000-0000-4000-8000-000000000000';

@Command({
  name: 'register-mesh-node',
  description: 'Register mesh node in global DB if it is missing',
})
@Injectable()
export class RegisterMeshNodeCommand extends CommandRunner {
  constructor(
    @Inject(DATABASE_SERVICE)
    private readonly databaseService: GlobalDatabaseService,
    @Inject(ENV_SERVICE)
    private readonly envService: EnvService,
  ) {
    super();
  }

  async run(): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      return;
    }

    const existing = await this.databaseService.db
      .select({ nodeId: schema.clusterNodes.nodeId })
      .from(schema.clusterNodes)
      .where(eq(schema.clusterNodes.nodeId, config.nodeId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`✅ Mesh node already registered: ${config.nodeId}`);
      return;
    }

    const clusterId = await this.resolveClusterId();

    await this.databaseService.db.insert(schema.clusterNodes).values({
      clusterId,
      nodeId: config.nodeId,
      serverUrl: config.serverUrl,
      status: 'active',
      healthy: true,
      metadata: {
        source: 'startup-bootstrap',
      },
      lastSeenAt: new Date(),
    });

    console.log(`✅ Registered mesh node: ${config.nodeId} (${config.serverUrl})`);
  }

  private getConfig(): { nodeId: string; serverUrl: string } | null {
    const nodeId = this.envService.get('MESH_NODE_ID')?.toString().trim();

    if (!nodeId) {
      console.log('⏭️  Skipping mesh node registration: MESH_NODE_ID is missing');
      return null;
    }

    if (!UUID_LIKE_REGEX.test(nodeId)) {
      console.log('⏭️  Skipping mesh node registration: node id must be UUID');
      return null;
    }

    const serverUrlRaw =
      this.envService.get('MESH_NODE_SERVER_URL')?.toString().trim()
      ?? this.envService.get('APP_URL')?.toString().trim()
      ?? `http://api:${this.envService.get('API_PORT').toString().trim()}`;

    return {
      nodeId,
      serverUrl: this.toNodeServerUrl(serverUrlRaw),
    };
  }

  private async resolveClusterId(): Promise<string> {
    const [existing] = await this.databaseService.db
      .select({ clusterId: schema.clusterNodes.clusterId })
      .from(schema.clusterNodes)
      .orderBy(asc(schema.clusterNodes.createdAt))
      .limit(1);

    return existing?.clusterId ?? DEFAULT_CLUSTER_ID;
  }

  private toNodeServerUrl(input: string): string {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === 'ws:') {
        return `http://${parsed.host}`;
      }
      if (parsed.protocol === 'wss:') {
        return `https://${parsed.host}`;
      }
      return parsed.origin;
    } catch {
      return input;
    }
  }
}
