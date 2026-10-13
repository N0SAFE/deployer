import {
  projects2,
  services2,
  deployments2,
  projectCollaborators2
} from "./migrations-r9ccee18.mjs";

// packages/nest/schema/src/global/deployment.schemas.ts
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
var projectSelectSchema2 = createSelectSchema(projects2);
var projectInsertSchema2 = createInsertSchema(projects2);
var projectUpdateSchema2 = createUpdateSchema(projects2);
var serviceSelectSchema2 = createSelectSchema(services2);
var serviceInsertSchema2 = createInsertSchema(services2);
var serviceUpdateSchema2 = createUpdateSchema(services2);
var deploymentSelectSchema2 = createSelectSchema(deployments2);
var deploymentInsertSchema2 = createInsertSchema(deployments2);
var deploymentUpdateSchema2 = createUpdateSchema(deployments2);
var projectCollaboratorSelectSchema2 = createSelectSchema(projectCollaborators2);
var projectCollaboratorInsertSchema2 = createInsertSchema(projectCollaborators2);
var projectCollaboratorUpdateSchema2 = createUpdateSchema(projectCollaborators2);

export { projectSelectSchema2, projectInsertSchema2, projectUpdateSchema2, serviceSelectSchema2, serviceInsertSchema2, serviceUpdateSchema2, deploymentSelectSchema2, deploymentInsertSchema2, deploymentUpdateSchema2, projectCollaboratorSelectSchema2, projectCollaboratorInsertSchema2, projectCollaboratorUpdateSchema2 };
