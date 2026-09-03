// Re-export contract-inferred types for convenience
export type TimeRange = "1h" | "6h" | "12h" | "1d" | "3d" | "7d" | "30d" | "90d" | "1y"
export type Granularity = "minute" | "hour" | "day"
export type ResourceKind = "cpu" | "memory" | "disk" | "network" | "all"
export type AggregationKind = "average" | "max" | "min" | "sum"
export type StorageBreakdown = "project" | "service" | "type" | "user"
export type ReportStatus = "pending" | "generating" | "completed" | "failed"
