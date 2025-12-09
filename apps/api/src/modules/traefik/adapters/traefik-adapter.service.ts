/**
 * Traefik Adapter Service
 * 
 * PURPOSE: Transform internal Traefik types to contract types
 * 
 * RESPONSIBILITIES:
 * - ValidationResult → Contract format transformations
 * - Ensure required fields are present
 * 
 * PATTERN: Service-Adapter Pattern
 * - Receives data as parameters
 * - Returns contract types
 * - Zero business logic
 * - Zero database calls
 */

import { Injectable } from '@nestjs/common';
import type { ValidationResult } from '@/core/modules/traefik/interfaces/validation.interfaces';

// Contract output type - explicit definition matching contract schema
interface ValidateConfigResponse {
    isValid: boolean;
    errors?: {
        path: string;
        message: string;
        code: string;
    }[];
    warnings?: {
        path: string;
        message: string;
    }[];
    variables?: {
        name: string;
        resolved: boolean;
        value?: unknown;
        error?: string;
    }[];
}

@Injectable()
export class TraefikAdapter {
    /**
     * Transform ValidationResult to contract format
     * Ensures all required fields are present with defaults
     */
    adaptValidationResultToContract(result: ValidationResult): ValidateConfigResponse {
        return {
            isValid: result.isValid,
            errors: result.errors.length > 0 ? result.errors.map(error => ({
                path: error.path,
                message: error.message,
                code: error.code ?? 'VALIDATION_ERROR',
            })) : undefined,
            warnings: result.warnings.length > 0 ? result.warnings.map(warning => ({
                path: warning.path,
                message: warning.message,
            })) : undefined,
            variables: result.variables ? result.variables.map(variable => ({
                name: variable.name,
                resolved: variable.resolved,
                value: variable.value,
                error: variable.error,
            })) : undefined,
        };
    }
}
