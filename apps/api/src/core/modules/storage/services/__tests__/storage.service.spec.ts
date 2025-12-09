import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageService } from '../storage.service';

class MockConstantsService {
  readonly constants: any;

  constructor(basePath: string) {
    this.constants = {
      FOLDER_LOCATION: {
        STORAGE_BASE_PATH: basePath,
        BACKUP_BASE_PATH: path.join(basePath, 'backups'),
      },
      UPLOAD_FILE: {},
    } as const;
  }
}

describe('StorageService.resolvePath', () => {
  let basePath: string;
  let service: StorageService;

  beforeAll(async () => {
    basePath = await fs.mkdtemp(path.join('/tmp', 'storage-service-'));
    service = new StorageService(new MockConstantsService(basePath) as any);
  });

  afterAll(async () => {
    if (basePath) {
      await fs.rm(basePath, { recursive: true, force: true });
    }
  });

  it('resolves a simple relative path inside the storage base', () => {
    const resolved = (service as any).resolvePath('files/data.txt');
    expect(resolved).toBe(path.resolve(basePath, 'files/data.txt'));
  });

  it('allows leading slashes while keeping the path inside the base directory', () => {
    const resolved = (service as any).resolvePath('/nested/info.json');
    expect(resolved).toBe(path.resolve(basePath, 'nested/info.json'));
  });

  it('returns the base path when an empty or root path is provided', () => {
    const resolvedEmpty = (service as any).resolvePath('');
    const resolvedRoot = (service as any).resolvePath('/');

    expect(resolvedEmpty).toBe(path.resolve(basePath));
    expect(resolvedRoot).toBe(path.resolve(basePath));
  });

  it('rejects path traversal attempts that escape the storage base', () => {
    expect(() => (service as any).resolvePath('../etc/passwd')).toThrow();
    expect(() => (service as any).resolvePath('../../outside.txt')).toThrow();
  });

  it('normalizes absolute inputs back into the storage base', () => {
    const outsidePath = path.resolve('/tmp', 'unrelated');
    const resolved = (service as any).resolvePath(outsidePath);
    expect(resolved).toBe(path.resolve(basePath, 'tmp/unrelated'));
  });
});
