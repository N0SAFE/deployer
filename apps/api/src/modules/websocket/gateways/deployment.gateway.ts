import { WebSocketGateway, WebSocketServer, SubscribeMessage, type OnGatewayConnection, type OnGatewayDisconnect, MessageBody, ConnectedSocket, } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { type DeploymentEvent, type LogMessageEvent, type DeploymentProgressEvent, type ProjectSubscription, type DeploymentSubscription, type ServiceSubscription, ProjectSubscriptionSchema, DeploymentSubscriptionSchema, ServiceSubscriptionSchema, } from '../schemas/websocket.schemas';
@Injectable()
@WebSocketGateway({
    cors: {
        origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3050',
        credentials: true,
    },
    namespace: '/deployments',
})
export class DeploymentWebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;
    private readonly logger = new Logger(DeploymentWebSocketGateway.name);
    private readonly connectedClients = new Map<string, Socket>();
    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
        this.connectedClients.set(client.id, client);
    }
    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
        this.connectedClients.delete(client.id);
    }
    @SubscribeMessage('subscribe_to_project')
    async handleSubscribeToProject(
    @MessageBody()
    data: ProjectSubscription, 
    @ConnectedSocket()
    client: Socket) {
        try {
            // Validate input
            const validatedData = ProjectSubscriptionSchema.parse(data);
            // Join project-specific room
            const room = `project:${validatedData.projectId}`;
            await client.join(room);
            this.logger.log(`Client ${client.id} subscribed to project ${validatedData.projectId}`);
            client.emit('subscription_confirmed', {
                type: 'project',
                id: validatedData.projectId,
                message: 'Successfully subscribed to project events',
            });
        }
        catch (error) {
            this.logger.error(`Failed to subscribe to project:`, error);
            client.emit('subscription_error', {
                error: 'Invalid subscription data',
                details: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    @SubscribeMessage('subscribe_to_deployment')
    async handleSubscribeToDeployment(
    @MessageBody()
    data: DeploymentSubscription, 
    @ConnectedSocket()
    client: Socket) {
        try {
            const validatedData = DeploymentSubscriptionSchema.parse(data);
            const room = `deployment:${validatedData.deploymentId}`;
            await client.join(room);
            this.logger.log(`Client ${client.id} subscribed to deployment ${validatedData.deploymentId}`);
            client.emit('subscription_confirmed', {
                type: 'deployment',
                id: validatedData.deploymentId,
                message: 'Successfully subscribed to deployment events',
            });
        }
        catch (error) {
            this.logger.error(`Failed to subscribe to deployment:`, error);
            client.emit('subscription_error', {
                error: 'Invalid subscription data',
                details: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    @SubscribeMessage('subscribe_to_service')
    async handleSubscribeToService(
    @MessageBody()
    data: ServiceSubscription, 
    @ConnectedSocket()
    client: Socket) {
        try {
            const validatedData = ServiceSubscriptionSchema.parse(data);
            const room = `service:${validatedData.serviceId}`;
            await client.join(room);
            this.logger.log(`Client ${client.id} subscribed to service ${validatedData.serviceId}`);
            client.emit('subscription_confirmed', {
                type: 'service',
                id: validatedData.serviceId,
                message: 'Successfully subscribed to service events',
            });
        }
        catch (error) {
            this.logger.error(`Failed to subscribe to service:`, error);
            client.emit('subscription_error', {
                error: 'Invalid subscription data',
                details: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    @SubscribeMessage('unsubscribe')
    async handleUnsubscribe(
    @MessageBody()
    data: {
        type: string;
        id: string;
    }, 
    @ConnectedSocket()
    client: Socket) {
        const room = `${data.type}:${data.id}`;
        await client.leave(room);
        this.logger.log(`Client ${client.id} unsubscribed from ${room}`);
        client.emit('unsubscribe_confirmed', {
            type: data.type,
            id: data.id,
            message: 'Successfully unsubscribed',
        });
    }
    // Broadcast deployment events to subscribed clients
    broadcastDeploymentEvent(event: DeploymentEvent) {
        const { deploymentId, projectId, serviceId } = event;
        // Send to deployment-specific subscribers
        this.server.to(`deployment:${deploymentId}`).emit('deployment_event', event);
        // Send to project-specific subscribers
        if (projectId) {
            this.server.to(`project:${projectId}`).emit('deployment_event', event);
        }
        // Send to service-specific subscribers
        if (serviceId) {
            this.server.to(`service:${serviceId}`).emit('deployment_event', event);
        }
        this.logger.debug(`Broadcasted deployment event: ${event.type} for deployment ${deploymentId}`);
    }
    // Broadcast log messages
    broadcastLogMessage(event: LogMessageEvent) {
        const { deploymentId } = event;
        // Send to deployment-specific subscribers
        this.server.to(`deployment:${deploymentId}`).emit('log_message', event);
        this.logger.debug(`Broadcasted log message for deployment ${deploymentId}: ${event.message}`);
    }
    // Broadcast deployment progress
    broadcastDeploymentProgress(event: DeploymentProgressEvent) {
        const { deploymentId } = event;
        // Send to deployment-specific subscribers
        this.server.to(`deployment:${deploymentId}`).emit('deployment_progress', event);
        this.logger.debug(`Broadcasted progress update for deployment ${deploymentId}: ${event.stage} ${event.progress}%`);
    }
    // Get connected clients count
    getConnectedClientsCount(): number {
        return this.connectedClients.size;
    }
    // Get rooms and their client counts
    async getRoomStats(): Promise<Record<string, number>> {
        const rooms = await this.server.in('/deployments').allSockets();
        const roomStats: Record<string, number> = {};
        for (const socketId of rooms) {
            const socket = this.connectedClients.get(socketId);
            if (socket) {
                for (const room of socket.rooms) {
                    if (room !== socketId && room !== '/deployments') {
                        roomStats[room] = (roomStats[room] || 0) + 1;
                    }
                }
            }
        }
        return roomStats;
    }
    // Send message to specific client
    sendToClient(clientId: string, event: string, data: any) {
        const client = this.connectedClients.get(clientId);
        if (client) {
            client.emit(event, data);
        }
    }
    // Broadcast system-wide notifications
    broadcastSystemNotification(message: string, level: 'info' | 'warn' | 'error' = 'info') {
        this.server.emit('system_notification', {
            message,
            level,
            timestamp: new Date(),
        });
    }
}
