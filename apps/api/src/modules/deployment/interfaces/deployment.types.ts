import type { z } from 'zod';
import { 
  deploymentGetStatusOutput,
  deploymentGetLogsOutput,
  deploymentJobStatusOutput,
} from '@repo/api-contracts';

/**
 * Deployment Module Type Definitions
 * 
 * PURPOSE: Type inference from contracts (TypeScript Type Manipulation Pattern #3)
 * PATTERN: Extract exact types from contracts using z.infer
 * 
 * RULES:
 * - Extract contract types using z.infer from Zod schemas (source of truth)
 * - No manual type duplication
 * - Keep types simple and inferred when possible
 */

// Contract output types (inferred from ORPC Zod schemas)
export type DeploymentStatusContract = z.infer<typeof deploymentGetStatusOutput>;
export type DeploymentLogsContract = z.infer<typeof deploymentGetLogsOutput>;
export type DeploymentJobStatusContract = z.infer<typeof deploymentJobStatusOutput>;
