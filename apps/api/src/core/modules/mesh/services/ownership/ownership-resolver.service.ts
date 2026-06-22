import { Injectable, Logger } from '@nestjs/common'
import { Subject, Observable } from 'rxjs'

export interface NodeDescriptor {
  id: string
  baseUrl: string
}

export interface OwnershipChange {
  resourceKey: string
  owners: string[]
}

@Injectable()
export class OwnershipResolverService {
  private readonly logger = new Logger(OwnershipResolverService.name)
  private nodes: NodeDescriptor[] = []
  private changes = new Subject<OwnershipChange>()

  registerNode(node: NodeDescriptor) {
    this.nodes.push(node)
    this.logger.debug(`Registered node ${node.id} ${node.baseUrl}`)
  }

  watchOwnership(resourceKey: string): Observable<OwnershipChange> {
    return this.changes.asObservable()
  }

  async resolveOwners(resourceKey: string): Promise<string[]> {
    const owners: string[] = []
    for (const node of this.nodes) {
      try {
        const url = new URL('/ownership', node.baseUrl)
        url.searchParams.set('entity', resourceKey)
        const controller = new AbortController()
        const timeout = setTimeout(() => { controller.abort(); }, 2000)

        const res = await fetch(url.toString(), { signal: controller.signal })
        clearTimeout(timeout)

        if (!res.ok) continue
        const body = await res.json()
        if (body?.owns) {
          owners.push(node.id)
        }
      } catch (err) {
        this.logger.warn(`Failed to query ownership ${node.id}: ${err}`)
      }
    }

    this.changes.next({ resourceKey, owners })
    return owners
  }
}
