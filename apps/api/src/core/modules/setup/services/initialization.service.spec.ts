import { Test, type TestingModule } from '@nestjs/testing';
import { InitializationService } from './initialization.service';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { NodeConfigRepository } from '../repositories/node-config.repository';
import { LocalInitializationService } from './local-initialization.service';
import { RemoteInitializationService } from './remote-initialization.service';
import { MeshInitializationService } from '../../mesh/initialization/services/mesh-initialization.service';
import { ReachabilityService } from '../../reachability/services/reachability.service';

describe('InitializationService', () => {
  let service: InitializationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InitializationService,
        {
          provide: NodeConfigRepository,
          useFactory: () => ({
            find: vi.fn(),
            save: vi.fn(),
            update: vi.fn(),
          }),
        },
        {
          provide: LocalInitializationService,
          useFactory: () => ({ initialize: vi.fn() }),
        },
        {
          provide: RemoteInitializationService,
          useFactory: () => ({ initialize: vi.fn() }),
        },
        {
          provide: MeshInitializationService,
          useFactory: () => ({
            bootstrap: vi.fn(),
            connectToMesh: vi.fn(),
            getMeshNodeUrls: vi.fn(),
          }),
        },
        {
          provide: ReachabilityService,
          useFactory: () => ({ checkMeshUrlReachability: vi.fn() }),
        },
      ],
    }).compile();

    service = module.get<InitializationService>(InitializationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStateMachine', () => {
    it('should return the full state machine definition', () => {
      const sm = service.getStateMachine();
      expect(sm.initialState).toBe('not_started');
      expect(sm.terminalStates).toContain('completed');
      expect(sm.states.length).toBeGreaterThan(0);
      expect(sm.transitions.length).toBeGreaterThan(0);
    });
  });
});
