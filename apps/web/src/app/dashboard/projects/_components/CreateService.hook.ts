'use client'

/* ===================================================================
 * CreateService.hook — TanStack Form hook for the service creation
 * wizard. The Zod schemas live in sibling files:
 *   CreateService.provider-schema.ts  → provider discriminated union
 *   CreateService.runner-schema.ts    → build method, sub-service, runner union
 *   CreateService.schema.ts           → health check, misc, full wizard schema
 *   CreateService.defaults.ts         → default form values
 *
 * rootPath / buildContext / dockerfilePath live under the RUNNER,
 * NOT the provider — they describe how to build, not where to pull.
 * =================================================================== */

import { useForm } from '@tanstack/react-form'
import type z from 'zod/v4'
import { defaultWizardValues } from './CreateService.defaults'
import type { providerSchema } from './CreateService.provider-schema'
import type { orchestratorSubServiceSchema, runnerSchema } from './CreateService.runner-schema'
import { wizardSchema, type WizardFormData } from './CreateService.schema'

/* ─── HOOK ────────────────────────────────────────────────────────── */

export function useCreateServiceForm(onConfirm: (data: WizardFormData) => Promise<void>) {
    const form = useForm({
        defaultValues: defaultWizardValues,
        onSubmit: async ({ value }) => {
            const parsed = wizardSchema.safeParse(value)
            if (!parsed.success) return
            await onConfirm(parsed.data)
        },
    })
    return form
}

export type CreateServiceFormApi = ReturnType<typeof useCreateServiceForm>

export type { WizardFormData }

export type ProviderFormData = z.infer<typeof providerSchema>
export type RunnerFormData = z.infer<typeof runnerSchema>
export type OrchestratorSubService = z.infer<typeof orchestratorSubServiceSchema>
