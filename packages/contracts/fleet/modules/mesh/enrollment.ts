import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import {
    meshEnrollmentDescribeInputSchema,
    meshEnrollmentDescribeResultSchema,
    meshEnrollmentEnrollInputSchema,
    meshEnrollmentEnrollResultSchema,
} from "@deployer/contracts-entities";
import { meshDomainErrorContracts, standard } from "@deployer/orpc-utils";

const describeOps = standard.zod(meshEnrollmentDescribeResultSchema, "meshEnrollmentDescribe");
const enrollOps = standard.zod(meshEnrollmentEnrollResultSchema, "meshEnrollmentEnroll");

/** Reached through the mesh by a node that holds a join token and is not part of the fleet yet. */
export const meshEnrollmentDescribeContract = describeOps
    .create()
    .path("/describe")
    .input((b) => b.body(meshEnrollmentDescribeInputSchema))
    .output(meshEnrollmentDescribeResultSchema)
    .errors((e) => meshDomainErrorContracts(e))
    .build();

export const meshEnrollmentEnrollContract = enrollOps
    .create()
    .path("/enroll")
    .input((b) => b.body(meshEnrollmentEnrollInputSchema))
    .output(meshEnrollmentEnrollResultSchema)
    .errors((e) => meshDomainErrorContracts(e))
    .build();

/**
 * Taking a node into the fleet. Mesh-only: it is served to the mesh and never composed into the public BFF router, and
 * every call proves itself with a join token instead of a user session.
 */
export const meshEnrollmentContract = oc
    .meta(openapi({ tags: ["Core Mesh Enrollment"], prefix: "/mesh/enrollment" }))
    .router({
        describe: meshEnrollmentDescribeContract,
        enroll: meshEnrollmentEnrollContract,
    });

export type MeshEnrollmentContract = typeof meshEnrollmentContract;
