import { Test, TestingModule } from '@nestjs/testing';
import { ReachabilityController } from './reachability.controller';

describe('ReachabilityController', () => {
  let controller: ReachabilityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReachabilityController],
    }).compile();

    controller = module.get<ReachabilityController>(ReachabilityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
