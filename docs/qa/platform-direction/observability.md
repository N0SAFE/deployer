# Q&A — Platform Direction: Observability

> **Module**: platform-direction  
> **Category**: observability  
> **Last updated**: 2026-03-04

---

## Metrics storage and export

**Q**: Where should analytics and health metrics be stored / exported?

**A**: Both — local storage in PostgreSQL displayed in the dashboard AND optional external export (Prometheus / Grafana / Datadog). External export is opt-in per cluster.
