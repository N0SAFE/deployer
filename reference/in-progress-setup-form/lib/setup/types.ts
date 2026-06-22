export type SetupMode = "remote" | "local"

export type WizardStep =
  | "mode"
  | "remote-url"
  | "remote-auth"
  | "remote-progress"
  | "local-account"
  | "local-database"
  | "local-progress"
  | "complete"

export type ConnectionState = "idle" | "checking" | "reachable" | "unreachable"

export type RemoteUser = {
  id: string
  name: string
  email: string
  avatarColor: string
}

export type RemoteState = {
  meshUrl: string
  meshName: string | null
  nodeCount: number | null
  user: RemoteUser | null
  sessionToken: string | null
}

export type LocalDbMode = "managed" | "existing"

export type LocalState = {
  username: string
  email: string
  password: string
  dbMode: LocalDbMode
  dbUrl: string
}

export type WizardState = {
  step: WizardStep
  mode: SetupMode | null
  remote: RemoteState
  local: LocalState
  finalNodeId: string | null
}

export type ProgressTaskStatus = "pending" | "running" | "done" | "error"

export type ProgressTask = {
  id: string
  label: string
  description: string
  status: ProgressTaskStatus
  logs: string[]
}
