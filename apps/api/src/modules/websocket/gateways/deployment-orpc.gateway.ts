import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { WebSocketEventService } from '../services/websocket-event.service';

interface ClientSubscriptions {
  deploymentId?: string;
  projectId?: string;
  serviceId?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*', // Configure this properly in production
    methods: ['GET', 'POST'],
  },
  namespace: '/deployments',
})
export class DeploymentORPCGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(DeploymentORPCGateway.name);
  private clientSubscriptions = new Map<string, ClientSubscriptions>();

  constructor(private readonly eventService: WebSocketEventService) {}

  afterInit(_server: Server) {
    this.logger.log('ORPC WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.clientSubscriptions.set(client.id, {});
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clientSubscriptions.delete(client.id);
  }

  @SubscribeMessage('deployment.subscribe')
  async handleSubscribe(
    @MessageBody() data: { deploymentId?: string; projectId?: string; serviceId?: string },
    @ConnectedSocket() client: Socket
  ) {
    const { deploymentId, projectId, serviceId } = data;

    // Update client subscriptions
    this.clientSubscriptions.set(client.id, { deploymentId, projectId, serviceId });

    // Join relevant rooms for real-time updates
    if (deploymentId) {
      await client.join(`deployment:${deploymentId}`);
    }
    if (projectId) {
      await client.join(`project:${projectId}`);
    }
    if (serviceId) {
      await client.join(`service:${serviceId}`);
    }

    this.logger.log(
      `Client ${client.id} subscribed to: ${JSON.stringify({ deploymentId, projectId, serviceId })}`
    );

    client.emit('subscription.confirmed', {
      deploymentId,
      projectId,
      serviceId,
      timestamp: new Date(),
    });
  }

  @SubscribeMessage('deployment.unsubscribe')
  async handleUnsubscribe(
    @MessageBody() data: { deploymentId?: string; projectId?: string; serviceId?: string },
    @ConnectedSocket() client: Socket
  ) {
    const { deploymentId, projectId, serviceId } = data;

    // Leave rooms
    if (deploymentId) {
      await client.leave(`deployment:${deploymentId}`);
    }
    if (projectId) {
      await client.leave(`project:${projectId}`);
    }
    if (serviceId) {
      await client.leave(`service:${serviceId}`);
    }

    // Clear subscriptions
    this.clientSubscriptions.delete(client.id);

    this.logger.log(
      `Client ${client.id} unsubscribed from: ${JSON.stringify({ deploymentId, projectId, serviceId })}`
    );

    client.emit('unsubscription.confirmed', {
      deploymentId,
      projectId,
      serviceId,
      timestamp: new Date(),
    });
  }

  /**
   * Set up event listeners to relay internal events to WebSocket clients
   * Note: This uses the existing WebSocketEventService which emits events directly to the gateway
   */
  private setupEventListeners() {
    this.logger.log('Event listeners set up - WebSocketEventService emits directly to the main gateway');
    // The existing WebSocketEventService already has the DeploymentWebSocketGateway injected
    // and emits events directly to it. This ORPC gateway is an additional interface.
  }

  /**
   * Broadcast deployment status update to all subscribed clients
   */
  broadcastDeploymentStatus(deploymentId: string, projectId: string, serviceId: string, data: any) {
    const event = {
      type: 'deployment.status',
      deploymentId,
      projectId,
      serviceId,
      data,
      timestamp: new Date(),
    };

    this.server.to(`deployment:${deploymentId}`).emit('deployment.status', event);
    this.server.to(`project:${projectId}`).emit('deployment.status', event);
    this.server.to(`service:${serviceId}`).emit('deployment.status', event);
  }

  /**
   * Broadcast deployment logs to subscribed clients
   */
  broadcastDeploymentLogs(deploymentId: string, logs: any[]) {
    const event = {
      type: 'deployment.logs',
      deploymentId,
      logs,
      timestamp: new Date(),
    };

    this.server.to(`deployment:${deploymentId}`).emit('deployment.logs', event);
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, event: string, data: any) {
    this.server.to(clientId).emit(event, {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Get statistics about connected clients
   */
  async getStats() {
    const sockets = await this.server.fetchSockets();
    const rooms = Array.from(this.server.sockets.adapter.rooms.keys());
    
    return {
      connectedClients: sockets.length,
      activeRooms: rooms.length,
      subscriptions: Array.from(this.clientSubscriptions.entries()).map(([clientId, subs]) => ({
        clientId,
        subscriptions: subs,
      })),
    };
  }
}