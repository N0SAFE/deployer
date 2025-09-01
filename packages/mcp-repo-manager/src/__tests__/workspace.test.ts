import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from '../services/workspace.service';
import { RepoToolsProvider } from '../tools/repo.tools';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [WorkspaceService],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should detect repository root', () => {
    const structure = service.getWorkspaceStructure();
    expect(structure).toBeDefined();
  });

  it('should list packages', async () => {
    const packages = await service.listPackages();
    expect(Array.isArray(packages)).toBe(true);
  });

  it('should list apps', async () => {
    const apps = await service.listApps();
    expect(Array.isArray(apps)).toBe(true);
  });
});

describe('RepoToolsProvider', () => {
  let provider: RepoToolsProvider;
  let service: WorkspaceService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [WorkspaceService, RepoToolsProvider],
    }).compile();

    provider = module.get<RepoToolsProvider>(RepoToolsProvider);
    service = module.get<WorkspaceService>(WorkspaceService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should list packages via MCP tool', async () => {
    const result = await provider.listPackages();
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('should list apps via MCP tool', async () => {
    const result = await provider.listApps();
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('should get workspace structure', async () => {
    const result = await provider.getWorkspaceStructure();
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('root');
    expect(result.data).toHaveProperty('packages');
    expect(result.data).toHaveProperty('apps');
  });
});