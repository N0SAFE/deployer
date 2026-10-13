import {
  collectContractLeaves2,
  resolveAtPath2
} from "./contract-leaves-kff9548x.mjs";

// packages/nest/service-client/src/base-client.ts
class BaseClient2 {
  service;
  contract;
  constructor(binder, options) {
    this.service = options.service;
    this.contract = options.contract;
    const bound = binder.bind(options.service, options.contract);
    this.raw = bound.raw;
    for (const leaf of collectContractLeaves2(options.contract)) {
      const procedure = resolveAtPath2(bound, [...leaf.path, leaf.name]);
      if (procedure === undefined || procedure === null)
        continue;
      Object.defineProperty(this, leaf.name, {
        value: procedure.bind(bound),
        enumerable: false,
        configurable: true,
        writable: false
      });
    }
  }
}

export { BaseClient2 };
