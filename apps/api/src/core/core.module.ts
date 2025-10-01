import { Module } from '@nestjs/common';
import { DockerService } from './services/docker.service';
import { GitService } from './services/git.service';
import { StaticFileService } from './services/static-file.service';
import { DeploymentService } from './services/deployment.service';
import { DeploymentHealthMonitorService } from './services/deployment-health-monitor.service';
import { ZombieCleanupService } from './services/zombie-cleanup.service';
import { TraefikModule } from '../modules/traefik/traefik.module';
import { ProjectServerService } from './services/project-server.service';

@Module({
    imports: [TraefikModule],
    providers: [
        DockerService,
        GitService,
        StaticFileService,
        // Project server service for per-project HTTP servers
        ProjectServerService,
        DeploymentService,
        DeploymentHealthMonitorService,
        // Zombie container cleanup service - runs hourly cron to reconcile and clean up orphaned containers
        ZombieCleanupService,
    ],
    exports: [
        DockerService,
        GitService,
        StaticFileService,
        ProjectServerService,
        DeploymentService,
        DeploymentHealthMonitorService,
        ZombieCleanupService,
    ],
})
export class CoreModule {
}
