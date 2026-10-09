'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { ManualDomainForm } from './manual-domain-form'
import { ProviderDomainForm } from './provider-domain-form'

export function AddDomainDialog({
  open,
  projectId,
  onOpenChange,
}: {
  open: boolean
  projectId: string
  onOpenChange: (open: boolean) => void
}) {
  const [tab, setTab] = useState('manual')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a domain</DialogTitle>
          <DialogDescription>
            A domain must be verified before it can serve traffic: you prove you own it with a DNS record.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">I create the record</TabsTrigger>
            <TabsTrigger value="provider">Via a DNS provider</TabsTrigger>
          </TabsList>
          <TabsContent value="manual">
            <ManualDomainForm projectId={projectId} onDone={() => { onOpenChange(false) }} />
          </TabsContent>
          <TabsContent value="provider">
            <ProviderDomainForm projectId={projectId} onDone={() => { onOpenChange(false) }} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
