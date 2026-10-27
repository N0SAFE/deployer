import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { MeshOrchestrationService } from './mesh-orchestration.service';
import { describe, it, expect, beforeEach } from "vitest";

describe('MeshOrchestrationService', () => {
  let service: MeshOrchestrationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MeshOrchestrationService],
    }).compile();

    service = module.get<MeshOrchestrationService>(MeshOrchestrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
