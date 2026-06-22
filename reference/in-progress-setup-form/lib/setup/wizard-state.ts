import type { WizardState } from "./types"

export const initialWizardState: WizardState = {
  step: "mode",
  mode: null,
  remote: {
    meshUrl: "",
    meshName: null,
    nodeCount: null,
    user: null,
    sessionToken: null,
  },
  local: {
    username: "",
    email: "",
    password: "",
    dbMode: "managed",
    dbUrl: "",
  },
  finalNodeId: null,
}

export function getStepIndex(state: WizardState): { current: number; total: number } {
  if (state.mode === "remote") {
    const order = ["mode", "remote-url", "remote-auth", "remote-progress", "complete"] as const
    const idx = order.indexOf(state.step as (typeof order)[number])
    return { current: idx === -1 ? 0 : idx, total: order.length }
  }
  if (state.mode === "local") {
    const order = ["mode", "local-account", "local-database", "local-progress", "complete"] as const
    const idx = order.indexOf(state.step as (typeof order)[number])
    return { current: idx === -1 ? 0 : idx, total: order.length }
  }
  return { current: 0, total: 5 }
}
