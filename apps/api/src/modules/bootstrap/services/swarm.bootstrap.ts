import { Global, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { DockerService } from "@/core/modules/docker/services/docker.service";

@Global()
@Injectable()
export class SwarmBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SwarmBootstrap.name);
  constructor(private readonly dockerService: DockerService) {}

  async onApplicationBootstrap() {
    await this.ensureSwarmInitialized();
  }

  private async ensureSwarmInitialized(): Promise<void> {
    try {
      const info = await this.dockerService.getDockerClient().info();
      if (info.Swarm && info.Swarm.LocalNodeState === "active") {
        this.logger.debug("Docker Swarm is already active");
        return;
      }
      this.logger.log("Initializing Docker Swarm...");
      await this.dockerService.getDockerClient().swarmInit({
        ListenAddr: "0.0.0.0:2377",
        AdvertiseAddr: "127.0.0.1:2377",
      });
      this.logger.log("Docker Swarm initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Docker Swarm:", error);
      // Don't throw - let the service continue, but log the error
    }
  }
}
