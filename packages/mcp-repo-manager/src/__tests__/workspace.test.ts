import { Test, TestingModule } from '@nestjs/testing';
import { RepositoryTool } from '../tools/repository.tool';
import { CreationTool } from '../tools/creation.tool';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('RepositoryTool', () => {
  let tool: RepositoryTool;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [RepositoryTool],
    }).compile();

    tool = module.get<RepositoryTool>(RepositoryTool);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(tool).toBeDefined();
  });
});

describe('CreationTool', () => {
  let tool: CreationTool;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [CreationTool],
    }).compile();

    tool = module.get<CreationTool>(CreationTool);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(tool).toBeDefined();
  });
});