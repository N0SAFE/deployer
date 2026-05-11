import { serviceOps } from "./shared";

export const serviceFindByIdContract = serviceOps
  .read()
  .output((b) => b.entitySchema.nullable())
  .build();
