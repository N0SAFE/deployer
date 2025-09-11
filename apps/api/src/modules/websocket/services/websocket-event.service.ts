import { Injectable, Logger } from '@nestjs/common';
import { DeploymentWebSocketGateway } from '../gateways/deployment.gateway';
import type {
    DeploymentEvent,
    LogMessageEvent,
    DeploymentProgressEvent,
} from '../schemas/websocket.schemas';
@Injectable()
export class WebSocketEventService {
    private readonly logger = new Logger(WebSocketEventService.name);
    constructor(private readonly deploymentGateway: DeploymentWebSocketGateway) { }
    // Emit deployment started event
    emitDeploymentStarted(deploymentId: string, projectId?: string, serviceId?: string) {
        const event: DeploymentEvent = {
            type: 'deployment_started',
            deploymentId,
            projectId,
            serviceId,
            timestamp: new Date(),
            data: {
                message: 'Deployment has been queued and will start shortly',
            },
        };
        this.deploymentGateway.broadcastDeploymentEvent(event);
        this.logger.log(`Emitted deployment started event for deployment ${deploymentId}`);
    }
    // Emit deployment progress event
    emitDeploymentProgress(deploymentId: string, stage: 'cloning' | 'building' | 'deploying' | 'health_check', progress: number, message?: string) {
        const event: DeploymentProgressEvent = {
            type: 'deployment_progress',
            deploymentId,
            stage,
            progress,
            message,
            timestamp: new Date(),
        };
        this.deploymentGateway.broadcastDeploymentProgress(event);
        this.logger.debug(`Progress update: ${deploymentId} - ${stage} ${progress}%`);
    }
    // Emit deployment completed event
    emitDeploymentCompleted(deploymentId: string, projectId?: string, serviceId?: string, data?: Record<string, unknown>) {
        const event: DeploymentEvent = {
            type: 'deployment_completed',
            deploymentId,
            projectId,
            serviceId,
            timestamp: new Date(),
            data: {
                message: 'Deployment completed successfully',
                ...data,
            },
        };
        this.deploymentGateway.broadcastDeploymentEvent(event);
        this.logger.log(`Emitted deployment completed event for deployment ${deploymentId}`);
    }
    // Emit deployment failed event
    emitDeploymentFailed(deploymentId: string, projectId?: string, serviceId?: string, error?: string, data?: Record<string, unknown>) {
        const event: DeploymentEvent = {
            type: 'deployment_failed',
            deploymentId,
            projectId,
            serviceId,
            timestamp: new Date(),
            data: {
                message: 'Deployment failed',
                error,
                ...data,
            },
        };
        this.deploymentGateway.broadcastDeploymentEvent(event);
        this.logger.log(`Emitted deployment failed event for deployment ${deploymentId}`);
    }
    // Emit deployment cancelled event
    emitDeploymentCancelled(deploymentId: string, projectId?: string, serviceId?: string, reason?: string) {
        const event: DeploymentEvent = {
            type: 'deployment_cancelled',
            deploymentId,
            projectId,
            serviceId,
            timestamp: new Date(),
            data: {
                message: 'Deployment was cancelled',
                reason,
            },
        };
        this.deploymentGateway.broadcastDeploymentEvent(event);
        this.logger.log(`Emitted deployment cancelled event for deployment ${deploymentId}`);
    }
    // Emit log message
    emitLogMessage(deploymentId: string, level: 'info' | 'warn' | 'error' | 'debug', message: string, metadata?: Record<string, unknown>) {
        const event: LogMessageEvent = {
            type: 'log_message',
            deploymentId,
            level,
            message,
            metadata,
            timestamp: new Date(),
        };
        this.deploymentGateway.broadcastLogMessage(event);
        // Only log info and above to avoid spam in development
        if (level !== 'debug') {
            this.logger.log(`[${level.toUpperCase()}] ${deploymentId}: ${message}`);
        }
    }
    // Emit system notification
    emitSystemNotification(message: string, level: 'info' | 'warn' | 'error' = 'info') {
        this.deploymentGateway.broadcastSystemNotification(message, level);
        this.logger.log(`System notification [${level.toUpperCase()}]: ${message}`);
    }
    // Get WebSocket statistics
    async getWebSocketStats() {
        const connectedClients = this.deploymentGateway.getConnectedClientsCount();
        const roomStats = await this.deploymentGateway.getRoomStats();
        return {
            connectedClients,
            rooms: roomStats,
            totalRooms: Object.keys(roomStats).length,
        };
    }
    // Send private message to specific client
    sendPrivateMessage(clientId: string, message: string, data?: Record<string, unknown>) {
        this.deploymentGateway.sendToClient(clientId, 'private_message', {
            message,
            data,
            timestamp: new Date(),
        });
    }
    // Convenience methods for common deployment stages
    emitSourceCodePreparing(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'cloning', 10, 'Preparing source code...');
    }
    emitSourceCodeReady(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'cloning', 25, 'Source code ready');
    }
    emitBuildStarted(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'building', 30, 'Starting container build...');
    }
    emitBuildInProgress(deploymentId: string, progress: number) {
        this.emitDeploymentProgress(deploymentId, 'building', 30 + (progress * 0.4), `Building... ${progress}%`);
    }
    emitBuildCompleted(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'building', 70, 'Container build completed');
    }
    emitDeploymentInProgress(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'deploying', 75, 'Deploying containers...');
    }
    emitHealthCheckStarted(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'health_check', 85, 'Running health checks...');
    }
    emitHealthCheckCompleted(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'health_check', 95, 'Health checks passed');
    }
    emitDeploymentReady(deploymentId: string) {
        this.emitDeploymentProgress(deploymentId, 'health_check', 100, 'Deployment is ready and healthy');
    }
}
