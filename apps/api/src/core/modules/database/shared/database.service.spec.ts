import { BaseDatabaseService } from './database.service';

describe('BaseDatabaseService', () => {
  it('should be defined', () => {
    const service = new BaseDatabaseService({
      run: () => {},
      execute: () => Promise.resolve(),
    } as any);
    expect(service).toBeDefined();
  });

  it('should report healthy when db methods work', () => {
    const service = new BaseDatabaseService({
      run: () => {},
      execute: () => Promise.resolve(),
    } as any);
    expect(service.isHealthy()).toBe(true);
  });
});
