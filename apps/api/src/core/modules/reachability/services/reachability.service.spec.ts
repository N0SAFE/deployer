import { Test, TestingModule } from '@nestjs/testing';
import { ReachabilityService } from './reachability.service';

describe('ReachabilityService', () => {
  let service: ReachabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReachabilityService],
    }).compile();

    service = module.get<ReachabilityService>(ReachabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
