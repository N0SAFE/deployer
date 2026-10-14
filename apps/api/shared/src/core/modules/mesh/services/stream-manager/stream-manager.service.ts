import { Injectable, Logger } from '@nestjs/common'
import { MeshConnectionRegistry } from '@/core/modules/mesh/connection/mesh-connection-registry'
import type { MeshFilterDescriptor, MeshConsumerId } from '@/core/modules/mesh/filter/mesh-filter.types'

@Injectable()
export class StreamManagerService {
  private readonly logger = new Logger(StreamManagerService.name)

  constructor(private readonly registry: MeshConnectionRegistry) {}

  /** Get or create a connection to node/entity/method for the given filter and attach consumer */
  async getOrCreateAndAttach(
    nodeId: string,
    entityKey: string,
    methodName: string,
    consumerId: MeshConsumerId,
    filter: MeshFilterDescriptor
  ) {
    // Find existing connections to this node/entity/method
    const open = this.registry.listOpen().filter(c => c.nodeId === nodeId && c.entityKey === entityKey && c.methodName === methodName)

    const decision = this.registry.decidePromotion(filter, open)

    if (decision.action === 'attach') {
      this.logger.debug(`Attaching to existing connection ${decision.connectionId}`)
      await this.registry.attach(decision.connectionId, consumerId, filter)
      return this.registry.lookup(nodeId, entityKey, methodName)
    }

    if (decision.action === 'promote') {
      this.logger.debug(`Promoting connection ${decision.connectionId}`)
      await this.registry.promote(decision.connectionId, decision.newFilter)
      await this.registry.attach(decision.connectionId, consumerId, filter)
      return this.registry.lookup(nodeId, entityKey, methodName)
    }

    // new connection
    this.logger.debug(`Opening new connection to ${nodeId} ${entityKey}:${methodName}`)
    const conn = await this.registry.open(nodeId, entityKey, methodName, consumerId, filter)
    return conn
  }
}
