import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { MeshInitializationService } from './mesh-initialization.service';
import { describe, it, expect, beforeEach } from "vitest";

describe('MeshInitializationService', () => {
  let service: MeshInitializationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MeshInitializationService],
    }).compile();

    service = module.get<MeshInitializationService>(MeshInitializationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
