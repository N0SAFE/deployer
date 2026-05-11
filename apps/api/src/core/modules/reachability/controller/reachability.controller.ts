import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  HttpCode,
  NotFoundException,
} from '@nestjs/common'
import type { Response } from 'express'
import { ReachabilityService } from '../services/reachability.service';
import { ApiResponse } from '@nestjs/swagger';

@Controller('reachability')
export class ReachabilityController {
  constructor(private readonly reachabilityService: ReachabilityService) {}

  /**
   * POST /reachability/check?url=https://my-server.com:3000
   * Starts a reachability check for the given URL.
   * Returns a Promise — waits until resolved or timeout.
   */
  @ApiResponse({ status: 200, description: 'Reachability check completed' })
  @Get('check')
  async checkReachability(
    @Query('url') url: string,
  ): Promise<{ url: string; reachable: boolean; probeUrl: string | null; latencyMs: number | null }> {
    if (!url) {
      throw new NotFoundException('Missing ?url= query parameter')
    }

    const { reachable, probeUrl, latencyMs } = await this.reachabilityService.checkMeshUrlReachability(url)

    return { url, reachable, probeUrl, latencyMs }
  }

  /**
   * GET /reachability/probe/:token
   * Called by external services (isitup, fetchers, or manually via curl).
   * Resolves the pending probe for the matching token.
   */
  @ApiResponse({ status: 200, description: 'Probe received and processed' })
  @Get('probe/:token')
  @HttpCode(200)
  handleProbe(
    @Param('token') token: string,
    @Res() res: Response,
  ): void {
    const resolved = this.reachabilityService.resolveProbeByToken(token)

    res.status(200).json({
      ok: true,
      resolved,
      ts: new Date().toISOString(),
    })
  }
}