/**
 * `no-injectable-service` — a service is an Effect `Context.Service`, not a Nest `@Injectable`.
 *
 * `@Injectable` hands the construction and the lifetime of a service to Nest's container: constructor-injected collaborators,
 * singleton/request scope, `OnModuleInit`/`OnModuleDestroy` hooks. The Effect integration inverts that: the service is a tag
 * with a `live` implementation, the module provides it (`{ provide: X, useValue: X.live }`), and the Effect runtime owns its
 * lifetime — so a spec swaps it with a `Layer` and its failures are tagged errors instead of thrown exceptions. A service left
 * on `@Injectable` is invisible to the module graph's type flow and keeps a second, untyped way of wiring dependencies alive.
 *
 * NO EXEMPTIONS. Guards, interceptors, pipes, exception filters, middleware, strategies and gateways are no longer Nest
 * classes either (`docs/architecture/effect-orpc-conventions.md`): each has an oRPC / Effect replacement and its own rule
 * (`nest-roles.ts`). `allow` lists the named classes that remain while they migrate; an app's ledger is that list.
 *
 * Syntactic on purpose: it needs no type information, so it runs natively under `bun lint`.
 */
import type { Rule } from "eslint";

interface Node {
	readonly type: string;
	readonly name?: string;
	readonly id?: Node;
	readonly callee?: Node;
	readonly object?: Node;
	readonly property?: Node;
	readonly expression?: Node;
	readonly decorators?: readonly Node[];
	readonly superClass?: Node;
}

/** `Injectable`, `Injectable()`, `common.Injectable()` — whichever way the decorator is spelt. */
function isInjectable(decorator: Node): boolean {
	const expression = decorator.expression;
	const target = expression?.type === "CallExpression" ? expression.callee : expression;
	if (target?.type === "Identifier") return target.name === "Injectable";
	return target?.type === "MemberExpression" && target.property?.name === "Injectable";
}

export function createNoInjectableServiceRule(): Rule.RuleModule {
	return {
		meta: {
			type: "problem",
			docs: {
				description:
					"A service is an Effect Context.Service tag with a `live` layer, not a Nest `@Injectable` provider.",
			},
			schema: [
				{
					type: "object",
					properties: { allow: { type: "array", items: { type: "string" }, uniqueItems: true } },
					additionalProperties: false,
				},
			],
			messages: {
				injectableService:
					"`{{name}}` is a Nest `@Injectable` service. Make it an Effect service — `class {{name}} extends Context.Service<{{name}}, Shape>()(\"{{name}}\")` with a static `live` layer — and provide it from its module as `{ provide: {{name}}, useValue: {{name}}.live }`, so the Effect runtime owns its construction and lifetime. If it is an RxJS stream hub, keep the Observable and produce it from an Effect service.",
			},
		},

		create(context) {
			const options = (context.options[0] ?? {}) as { readonly allow?: readonly string[] };
			const allowed = new Set(options.allow ?? []);

			return {
				ClassDeclaration(raw) {
					const node = raw as unknown as Node;
					const name = node.id?.name;
					if (name === undefined || allowed.has(name)) return;
					if (!(node.decorators ?? []).some(isInjectable)) return;

					context.report({ node: node.id as unknown as Rule.Node, messageId: "injectableService", data: { name } });
				},
			};
		},
	};
}
