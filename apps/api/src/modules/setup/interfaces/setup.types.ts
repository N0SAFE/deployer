import { z } from 'zod';
import { checkSetupStatusOutput, createInitialUserOutput } from '@repo/api-contracts';

// Extract exact output types from contracts using z.infer
export type SetupStatusContract = z.infer<typeof checkSetupStatusOutput>;
export type InitialUserContract = z.infer<typeof createInitialUserOutput>;
