'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'

export interface TriggerChoice { serviceId: string; environment: string }

/** Deploy dialog: both fields are required and errors sit next to the field. */
export function TriggerDialog({
  services,
  environments,
  pending,
  onSubmit,
  onClose,
}: {
  services: readonly { id: string; name: string }[]
  environments: readonly { id: string; name: string; kind?: string }[]
  pending: boolean
  onSubmit: (choice: TriggerChoice) => void
  onClose: () => void
}) {
  const [serviceId, setServiceId] = useState(services.length === 1 ? (services[0]?.id ?? '') : '')
  const [environment, setEnvironment] = useState(environments.find((e) => e.name === 'production')?.name ?? '')
  const [touched, setTouched] = useState(false)
  const serviceError = touched && serviceId === '' ? 'Choose the service to deploy.' : null
  const envError = touched && environment === '' ? 'Choose the environment to deploy to.' : null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (serviceId !== '' && environment !== '') onSubmit({ serviceId, environment })
          }}
        >
          <DialogHeader>
            <DialogTitle>Deploy a service</DialogTitle>
            <DialogDescription>Starts a new deployment run from the service’s configured source.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="trigger-service">Service</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger id="trigger-service" aria-invalid={serviceError !== null}><SelectValue placeholder="Select a service" /></SelectTrigger>
              <SelectContent>
                {services.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
              </SelectContent>
            </Select>
            {serviceError ? <p role="alert" className="text-sm text-destructive">{serviceError}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="trigger-environment">Environment</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger id="trigger-environment" aria-invalid={envError !== null}><SelectValue placeholder="Select an environment" /></SelectTrigger>
              <SelectContent>
                {environments.length === 0 ? (
                  <SelectItem value="__none__" disabled>No environments defined</SelectItem>
                ) : environments.map((env) => (
                  <SelectItem key={env.id} value={env.name} className="capitalize">{env.name}{env.kind ? ` · ${env.kind}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {envError ? <p role="alert" className="text-sm text-destructive">{envError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Starting…' : 'Deploy'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
