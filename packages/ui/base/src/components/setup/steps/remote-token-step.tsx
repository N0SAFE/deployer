"use client"

import { ArrowLeft, ArrowRight, KeyRound } from "lucide-react"
import { useState } from "react"

import { Button } from "@deployer/ui/components/shadcn/button"
import { Label } from "@deployer/ui/components/shadcn/label"
import { Textarea } from "@deployer/ui/components/shadcn/textarea"

interface Props {
  initialToken: string
  onBack: () => void
  onContinue: (data: { token: string }) => void
}

/**
 * The one thing a node needs to join a fleet: the join token issued on a node that is already in it. It carries where
 * to find the swarm and the credential that proves membership, so there is no address to type and no account to sign in
 * to.
 */
export function RemoteTokenStep({ initialToken, onBack, onContinue }: Props) {
  const [token, setToken] = useState(initialToken)
  const trimmed = token.trim()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">Join an existing fleet</h2>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
          On a node of the fleet, open Nodes → Diagnostics → Add a node and issue a join token, then paste it here. It is
          shown once and valid for an hour.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="join-token" className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Join token
        </Label>
        <Textarea
          id="join-token"
          value={token}
          onChange={(event) => { setToken(event.target.value) }}
          placeholder="Paste the join token"
          className="font-mono text-xs min-h-28 break-all"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button size="lg" type="button" disabled={trimmed.length === 0} onClick={() => { onContinue({ token: trimmed }) }} className="gap-2">
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
