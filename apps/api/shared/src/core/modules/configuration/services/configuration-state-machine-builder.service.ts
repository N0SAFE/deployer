import { Injectable } from "@nestjs/common";
import {
    type ConfigurationLifecycleState,
    type ConfigurationProviderType,
    type ConfigurationRunnerType,
    type ConfigurationScope,
    type RequestedEnvironment,
    type RuntimeConfigurationDispatchConditionInput,
    type RuntimeConfigurationDispatchPatchInput,
    runtimeConfigurationStateMachineSchema,
    type RuntimeConfigurationDispatchRuleInput,
    type RuntimeConfigurationStateMachine,
    type RuntimeConfigurationStateNodeInput,
    type RuntimeConfigurationStateTransitionInput,
} from "../schemas/runtime-configuration.schema";

@Injectable()
export class ConfigurationStateMachineBuilderService {
    create(): RuntimeConfigurationStateMachineBuilder {
        return new RuntimeConfigurationStateMachineBuilder();
    }

    policy(): RuntimeConfigurationPolicyDsl {
        return new RuntimeConfigurationPolicyDsl(this.create());
    }
}

export class RuntimeConfigurationStateMachineBuilder {
    private readonly nodes: RuntimeConfigurationStateNodeInput[] = [];
    private readonly transitions: RuntimeConfigurationStateTransitionInput[] = [];
    private readonly rules: RuntimeConfigurationDispatchRuleInput[] = [];

    defineNode(node: RuntimeConfigurationStateNodeInput): this {
        this.nodes.push(node);
        return this;
    }

    defineTransition(transition: RuntimeConfigurationStateTransitionInput): this {
        this.transitions.push(transition);
        return this;
    }

    defineRule(rule: RuntimeConfigurationDispatchRuleInput): this {
        this.rules.push(rule);
        return this;
    }

    policy(): RuntimeConfigurationPolicyDsl {
        return new RuntimeConfigurationPolicyDsl(this);
    }

    build(): RuntimeConfigurationStateMachine {
        return runtimeConfigurationStateMachineSchema.parse({
            nodes: this.nodes,
            transitions: this.transitions,
            dispatch: {
                rules: this.rules,
            },
        });
    }
}

export class RuntimeConfigurationPolicyDsl {
    constructor(private readonly builder: RuntimeConfigurationStateMachineBuilder) {}

    node(scope: ConfigurationScope, lifecycleState: ConfigurationLifecycleState): RuntimeNodeDsl {
        return new RuntimeNodeDsl(this, {
            scope,
            lifecycleState,
        });
    }

    transition(
        from: ConfigurationLifecycleState,
        to: ConfigurationLifecycleState,
    ): RuntimeTransitionDsl {
        return new RuntimeTransitionDsl(this, { from, to });
    }

    rule(id: string): RuntimeRuleDsl {
        return new RuntimeRuleDsl(this, {
            id,
            when: {},
            apply: {},
        });
    }

    defineNode(node: RuntimeConfigurationStateNodeInput): this {
        this.builder.defineNode(node);
        return this;
    }

    defineTransition(transition: RuntimeConfigurationStateTransitionInput): this {
        this.builder.defineTransition(transition);
        return this;
    }

    defineRule(rule: RuntimeConfigurationDispatchRuleInput): this {
        this.builder.defineRule(rule);
        return this;
    }

    build(): RuntimeConfigurationStateMachine {
        return this.builder.build();
    }
}

class RuntimeNodeDsl {
    private readonly node: RuntimeConfigurationStateNodeInput;

    constructor(
        private readonly policy: RuntimeConfigurationPolicyDsl,
        node: RuntimeConfigurationStateNodeInput,
    ) {
        this.node = node;
    }

    describe(description: string): this {
        this.node.description = description;
        return this;
    }

    dependsOn(...scopes: ConfigurationScope[]): this {
        this.node.dependsOnScopes = scopes;
        return this;
    }

    allowProviders(...providers: ConfigurationProviderType[]): this {
        this.node.allowedProviderTypes = providers;
        return this;
    }

    allowRunners(...runners: ConfigurationRunnerType[]): this {
        this.node.allowedRunnerTypes = runners;
        return this;
    }

    done(): RuntimeConfigurationPolicyDsl {
        return this.policy.defineNode(this.node);
    }
}

class RuntimeTransitionDsl {
    private readonly transition: RuntimeConfigurationStateTransitionInput;

    constructor(
        private readonly policy: RuntimeConfigurationPolicyDsl,
        transition: RuntimeConfigurationStateTransitionInput,
    ) {
        this.transition = transition;
    }

    when(condition: RuntimeConfigurationDispatchConditionInput): this {
        this.transition.when = {
            ...(this.transition.when ?? {}),
            ...condition,
        };
        return this;
    }

    describe(description: string): this {
        this.transition.description = description;
        return this;
    }

    done(): RuntimeConfigurationPolicyDsl {
        return this.policy.defineTransition(this.transition);
    }
}

class RuntimeRuleDsl {
    private readonly rule: RuntimeConfigurationDispatchRuleInput;

    constructor(
        private readonly policy: RuntimeConfigurationPolicyDsl,
        rule: RuntimeConfigurationDispatchRuleInput,
    ) {
        this.rule = rule;
    }

    describe(description: string): this {
        this.rule.description = description;
        return this;
    }

    priority(priority: number): this {
        this.rule.priority = priority;
        return this;
    }

    disable(): this {
        this.rule.enabled = false;
        return this;
    }

    when(condition: RuntimeConfigurationDispatchConditionInput): this {
        this.rule.when = {
            ...(this.rule.when ?? {}),
            ...condition,
        };
        return this;
    }

    whenEnvironment(...environments: RequestedEnvironment[]): this {
        return this.when({ requestedEnvironmentIn: environments });
    }

    whenScope(...scopes: ConfigurationScope[]): this {
        return this.when({ scopeIn: scopes });
    }

    apply(patch: RuntimeConfigurationDispatchPatchInput): this {
        this.rule.apply = {
            ...this.rule.apply,
            ...patch,
        };
        return this;
    }

    constrain(patch: NonNullable<RuntimeConfigurationDispatchPatchInput["constraints"]>): this {
        return this.apply({
            constraints: {
                ...(this.rule.apply.constraints ?? {}),
                ...patch,
            },
        });
    }

    done(): RuntimeConfigurationPolicyDsl {
        return this.policy.defineRule(this.rule);
    }
}
