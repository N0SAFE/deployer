import { Module } from '@nestjs/common';
import { ReachabilityService } from './services/reachability.service';
import { ReachabilityController } from './controller/reachability.controller';

@Module({
  providers: [ReachabilityService],
  controllers: [ReachabilityController],
  exports: [ReachabilityService],
})
export class CoreReachabilityModule {}
