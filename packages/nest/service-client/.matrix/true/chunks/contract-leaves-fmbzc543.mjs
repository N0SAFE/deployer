// packages/nest/service-client/src/service-client.registry.ts
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";

class ServiceClientRegistry2 {
  options;
  clientsByService = new Map;
  origins = new Map;
  constructor(options) {
    this.options = options;
  }
  bind(service, contract) {
    const base = this.rawClientFor(service, contract);
    const bound = new Proxy(base, {
      get: (target, property, receiver) => {
        if (property === "raw")
          return target;
        if (property === "service")
          return service;
        if (property === "contract")
          return contract;
        return Reflect.get(target, property, receiver);
      }
    });
    return bound;
  }
  describe() {
    const names = new Set([...this.clientsByService.keys(), ...this.origins.keys()]);
    return [...names].map((service) => ({ service, origin: this.originFor(service) }));
  }
  rawClientFor(service, contract) {
    let byContract = this.clientsByService.get(service);
    if (byContract === undefined) {
      byContract = new WeakMap;
      this.clientsByService.set(service, byContract);
    }
    const existing = byContract.get(contract);
    if (existing !== undefined) {
      return existing;
    }
    const client = createORPCClient(new OpenAPILink(contract, {
      origin: this.originFor(service),
      fetch: (request, init) => {
        const extra = this.options.headers?.() ?? {};
        return fetch(request, {
          ...init,
          headers: { ...init?.headers, ...extra }
        });
      }
    }));
    byContract.set(contract, client);
    return client;
  }
  originFor(service) {
    const cached = this.origins.get(service);
    if (cached !== undefined)
      return cached;
    const resolved = this.options.resolveOrigin(service);
    this.origins.set(service, resolved);
    return resolved;
  }
}

export { ServiceClientRegistry2 };
