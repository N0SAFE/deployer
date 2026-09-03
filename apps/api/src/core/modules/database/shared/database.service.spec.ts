import { BaseDatabaseService } from './database.service';
import { describe, it, expect, beforeEach } from "vitest";

/** Concrete harness subclass (the base is abstract). */
class HarnessDatabaseService extends BaseDatabaseService<never> {}

describe('BaseDatabaseService', () => {
  it('should be defined', () => {
    const service = new HarnessDatabaseService({} as never);
    expect(service).toBeDefined();
  });

  it('should report healthy when the db handle is present', () => {
    // `isHealthy` only needs a duck-typed handle — {} with no run/execute
    // throws, so give it a run-capable one to exercise the healthy path.
    const service = new HarnessDatabaseService({ run: () => undefined } as never);
    expect(service.isHealthy()).toBe(true);
  });
});
