import { describe, it, expect, beforeEach } from "vitest";
import { ServiceDagService } from "./service-dag.service";
import { FleetRolloutPlannerService } from "./fleet-rollout-planner.service";
import type { DependencyTemplateConfig } from "@repo/contracts-entities";

const mkConfig = (rolloutMode: DependencyTemplateConfig["rolloutMode"]): Pick<DependencyTemplateConfig, "rolloutMode" | "retryPolicy"> => ({
    rolloutMode,
    retryPolicy: { maxAttempts: 3, backoffMs: 100 },
});

describe("FleetRolloutPlannerService", () => {
    let dagSvc: ServiceDagService;
    let planner: FleetRolloutPlannerService;

    beforeEach(() => {
        dagSvc = new ServiceDagService();
        planner = new FleetRolloutPlannerService();
    });

    const buildLinearDag = () =>
        dagSvc.build([
            { serviceId: "A", dependsOnServiceId: "B", isRequired: true },
            { serviceId: "B", dependsOnServiceId: "C", isRequired: true },
        ]);

    describe("ordered mode", () => {
        it("produces one wave per DAG layer", () => {
            const dag = buildLinearDag();
            const plan = planner.plan(dag, mkConfig("ordered"));
            expect(plan.mode).toBe("ordered");
            expect(plan.waves).toHaveLength(3);
            expect(plan.waves[0]?.serviceIds).toEqual(["C"]);
            expect(plan.waves[1]?.serviceIds).toEqual(["B"]);
            expect(plan.waves[2]?.serviceIds).toEqual(["A"]);
        });
    });

    describe("parallel mode", () => {
        it("produces a single wave with all services", () => {
            const dag = buildLinearDag();
            const plan = planner.plan(dag, mkConfig("parallel"));
            expect(plan.mode).toBe("parallel");
            expect(plan.waves).toHaveLength(1);
            expect(plan.waves[0]?.serviceIds.sort()).toEqual(["A", "B", "C"]);
        });
    });

    describe("rolling mode", () => {
        it("chunks layers by maxConcurrent", () => {
            const flatDag = dagSvc.build([
                { serviceId: "A", dependsOnServiceId: "Z", isRequired: true },
                { serviceId: "B", dependsOnServiceId: "Z", isRequired: true },
                { serviceId: "C", dependsOnServiceId: "Z", isRequired: true },
            ]);
            const plan = planner.plan(flatDag, mkConfig("rolling"), { rolling: { maxConcurrent: 2, wavePauseMs: 0 } });
            expect(plan.mode).toBe("rolling");
            // Z in layer 0 (1 service), A+B+C in layer 1 chunked into 2 waves
            const totalWaves = plan.waves.length;
            expect(totalWaves).toBeGreaterThanOrEqual(2);
            // Verify no wave exceeds maxConcurrent
            for (const wave of plan.waves) {
                expect(wave.serviceIds.length).toBeLessThanOrEqual(2);
            }
        });
    });

    describe("canary mode", () => {
        it("first service of first layer gets canary wave", () => {
            const dag = buildLinearDag();
            const plan = planner.plan(dag, mkConfig("canary"), {
                canary: { canaryWeight: 20, promotionWindowMinutes: 15 },
            });
            expect(plan.mode).toBe("canary");
            expect(plan.waves[0]?.mode).toBe("canary");
            expect(plan.waves[0]?.canaryConfig?.canaryWeight).toBe(20);
            expect(plan.waves[0]?.serviceIds).toHaveLength(1);
        });
    });
});
