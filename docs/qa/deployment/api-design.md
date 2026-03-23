# Q&A — Deployment: API Design

> **Module**: deployment  
> **Category**: api-design  
> **Last updated**: 2026-03-19

---

## ZIP upload API surface

**Q**: Do you want a dedicated deployment upload endpoint now (file -> uploadId/uploadPath), or will clients provide uploadPath themselves?

**A**: Add dedicated upload endpoint now.

---

## Success URL exposure

**Q**: When deployment succeeds, should we persist and expose a primary access URL (domainUrl) from route verification metadata?

**A**: Yes, persist and expose domainUrl.

---
