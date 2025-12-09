import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { DeploymentRulesService } from '@/core/modules/deployment/services/deployment-rules.service'
import type {
  CreateDeploymentRuleInput,
  UpdateDeploymentRuleInput,
} from '@/core/modules/deployment/services/deployment-rules.service'

// NOTE: AuthGuard is registered as a global guard (APP_GUARD) in AppModule,
// so it automatically protects all routes. No need for @UseGuards(AuthGuard) here.

@Controller('deployment-rules')
export class DeploymentRulesController {
  constructor(
    private readonly deploymentRulesService: DeploymentRulesService
  ) {}

  /**
   * POST /deployment-rules
   * Create a new deployment rule
   */
  @Post()
  async create(@Body() body: CreateDeploymentRuleInput) {
    // Validate rule configuration
    const validation =
      this.deploymentRulesService.validateRuleConfig(body)

    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Invalid deployment rule configuration',
        errors: validation.errors,
      })
    }

    return this.deploymentRulesService.createRule(body)
  }

  /**
   * GET /deployment-rules/:id
   * Get a deployment rule by ID
   */
  @Get(':id')
  async getById(@Param('id') id: string) {
    const rule = await this.deploymentRulesService.getRuleById(id)

    if (!rule) {
      throw new NotFoundException(`Deployment rule with ID ${id} not found`)
    }

    return rule
  }

  /**
   * GET /deployment-rules?serviceId=xxx
   * List deployment rules for a service
   */
  @Get()
  async list(@Query('serviceId') serviceId?: string) {
    if (!serviceId) {
      throw new BadRequestException('serviceId query parameter is required')
    }

    return this.deploymentRulesService.listRulesByService(serviceId)
  }

  /**
   * PATCH /deployment-rules/:id
   * Update a deployment rule
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateDeploymentRuleInput
  ) {
    const rule = await this.deploymentRulesService.updateRule(id, body)

    if (!rule) {
      throw new NotFoundException(`Deployment rule with ID ${id} not found`)
    }

    return rule
  }

  /**
   * DELETE /deployment-rules/:id
   * Delete a deployment rule
   */
  @Delete(':id')
  async delete(@Param('id') id: string) {
    const deleted = await this.deploymentRulesService.deleteRule(id)

    if (!deleted) {
      throw new NotFoundException(`Deployment rule with ID ${id} not found`)
    }

    return { success: true, message: 'Deployment rule deleted successfully' }
  }

  /**
   * POST /deployment-rules/:id/toggle
   * Toggle a deployment rule's enabled state
   */
  @Post(':id/toggle')
  async toggle(@Param('id') id: string) {
    const rule = await this.deploymentRulesService.toggleRule(id)

    if (!rule) {
      throw new NotFoundException(`Deployment rule with ID ${id} not found`)
    }

    return rule
  }

  /**
   * POST /deployment-rules/:id/test
   * Test if a rule would match a given event
   */
  @Post(':id/test')
  async test(
    @Param('id') id: string,
    @Body()
    testEvent: {
      type: 'push' | 'pull_request' | 'tag' | 'release'
      branch?: string
      tag?: string
      prAction?: string
      prLabels?: string[]
      prTargetBranch?: string
    }
  ) {
    const rule = await this.deploymentRulesService.getRuleById(id)

    if (!rule) {
      throw new NotFoundException(`Deployment rule with ID ${id} not found`)
    }

    const result = this.deploymentRulesService.testRuleMatch(rule, testEvent)

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      testEvent,
      ...result,
    }
  }
}
