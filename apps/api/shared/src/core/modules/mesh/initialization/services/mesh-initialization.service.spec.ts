import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from "vitest";

import { MeshInitializationService } from './mesh-initialization.service';

import type { TestingModule } from '@nestjs/testing';

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
