'use client'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import type { Confirmation } from '../_utils/node-change-guard'

/** Confirms a node change that can reduce quorum or leave the cluster without ingress; shows the consequence. */
export function ConfirmNodeChangeDialog({ confirmation, pending, onCancel, onConfirm }: { confirmation: Confirmation | null; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
	return (
		<Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{confirmation?.title}</DialogTitle>
					<DialogDescription>{confirmation?.consequence}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
					<Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
						{pending ? 'Applying…' : confirmation?.confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
