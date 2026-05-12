import type { z } from "zod";
import type { MeshQuery } from "../mesh-query";
import type { MeshQueryExecutor } from "./mesh-query-executor";
import type { BuilderResultShape } from "./mesh-query-builder-types";

// Enhanced JoinConfigurator to match v2 pattern
interface JoinConfigurator<TLeft, TRight> {
    as<TAlias extends string>(alias: TAlias): { 
        on: (predicate: (left: TLeft, right: TRight) => boolean) => 
        JoinConfiguratorResult<TLeft, TRight, TAlias> 
    };
    
    type: (joinType: 'inner' | 'left') => JoinConfigurator<TLeft, TRight>;
}

interface JoinConfiguratorResult<TLeft, TRight, TAlias extends string> {
    on: (predicate: (left: TLeft, right: TRight) => boolean) => 
    MeshQueryBuilder<TLeft, WithJoin<TLeft, TAlias, TRight>>;
}

type WithJoin<TBase, TAlias extends string, TJoined, TType extends 'left' | 'inner' = 'left'> = 
    TBase & Record<TAlias, TType extends 'inner' ? TJoined : TJoined | null>;

export class MeshQueryBuilder<
    TItem,
    TResultShape = TItem
> {
    public readonly whereClauses: readonly Partial<TItem>[];
    public readonly joins: readonly { 
        right: MeshQueryBuilder<unknown, unknown>, 
        config: (config: any) => void 
    }[];
    public readonly selectedFields: readonly (keyof TResultShape)[] | null;
    public readonly orderByClauses: readonly { 
        field: keyof TResultShape; 
        direction: 'asc' | 'desc' 
    }[];
    public readonly limitValue: number | null;
    public readonly offsetValue: number | null;
    public readonly _scope: Record<string, any> | null;
    
    public constructor(
        public readonly executor: MeshQueryExecutor,
        public readonly query: MeshQuery<z.ZodType, z.ZodType> & { itemSchema: z.ZodType<TItem> },
        state?: {
            whereClauses?: readonly Partial<TItem>[];
            joins?: readonly { 
                right: MeshQueryBuilder<unknown, unknown>, 
                config: (config: any) => void 
            }[];
            selectedFields?: readonly (keyof TResultShape)[] | null;
            orderByClauses?: readonly { 
                field: keyof TResultShape; 
                direction: 'asc' | 'desc' 
            }[];
            limitValue?: number | null;
            offsetValue?: number | null;
            scope?: Record<string, any> | null;
        }
    ) {
        this.whereClauses = state?.whereClauses ?? [];
        this.joins = state?.joins ?? [];
        this.selectedFields = state?.selectedFields ?? null;
        this.orderByClauses = state?.orderByClauses ?? [];
        this.limitValue = state?.limitValue ?? null;
        this.offsetValue = state?.offsetValue ?? null;
        this._scope = state?.scope ?? null;
    }

    static create<TItem>(
        executor: MeshQueryExecutor,
        query: MeshQuery<z.ZodType, z.ZodType> & { itemSchema: z.ZodType<TItem> }
    ): MeshQueryBuilder<TItem, TItem> {
        return new MeshQueryBuilder(executor, query);
    }

    where(clauses: Partial<TItem>): MeshQueryBuilder<TItem, TResultShape> {
        return new MeshQueryBuilder(this.executor, this.query, {
            whereClauses: [...this.whereClauses, clauses],
            joins: this.joins,
            selectedFields: this.selectedFields,
            orderByClauses: this.orderByClauses,
            limitValue: this.limitValue,
            offsetValue: this.offsetValue,
            scope: this._scope,
        });
    }

    select<K extends keyof TResultShape>(
        fields: readonly K[]
    ): MeshQueryBuilder<TItem, Pick<TResultShape, K>> {
        return new MeshQueryBuilder<TItem, Pick<TResultShape, K>>(this.executor, this.query, {
            whereClauses: this.whereClauses,
            joins: this.joins,
            selectedFields: fields,
            orderByClauses: this.orderByClauses,
            limitValue: this.limitValue,
            offsetValue: this.offsetValue,
            scope: this._scope,
        });
    }

    orderBy<K extends keyof TResultShape>(
        field: K,
        direction: 'asc' | 'desc' = 'asc'
    ): MeshQueryBuilder<TItem, TResultShape> {
        return new MeshQueryBuilder(this.executor, this.query, {
            whereClauses: this.whereClauses,
            joins: this.joins,
            selectedFields: this.selectedFields,
            orderByClauses: [...this.orderByClauses, { field, direction }],
            limitValue: this.limitValue,
            offsetValue: this.offsetValue,
            scope: this._scope,
        });
    }

    limit(value: number): MeshQueryBuilder<TItem, TResultShape> {
        return new MeshQueryBuilder(this.executor, this.query, {
            whereClauses: this.whereClauses,
            joins: this.joins,
            selectedFields: this.selectedFields,
            orderByClauses: this.orderByClauses,
            limitValue: value,
            offsetValue: this.offsetValue,
            scope: this._scope,
        });
    }

    offset(value: number): MeshQueryBuilder<TItem, TResultShape> {
        return new MeshQueryBuilder(this.executor, this.query, {
            whereClauses: this.whereClauses,
            joins: this.joins,
            selectedFields: this.selectedFields,
            orderByClauses: this.orderByClauses,
            limitValue: this.limitValue,
            offsetValue: value,
            scope: this._scope,
        });
    }

    scope<S extends Record<string, any>>(scope: S): MeshQueryBuilder<TItem, TResultShape> {
        return new MeshQueryBuilder(this.executor, this.query, {
            whereClauses: this.whereClauses,
            joins: this.joins,
            selectedFields: this.selectedFields,
            orderByClauses: this.orderByClauses,
            limitValue: this.limitValue,
            offsetValue: this.offsetValue,
            scope: { ...(this._scope ?? {}), ...scope },
        });
    }

    join<
        TRightBuilder extends MeshQueryBuilder<unknown, unknown>,
        TRight = BuilderResultShape<TRightBuilder>,
        TAlias extends string = "joined"
    >(
        right: TRightBuilder,
        configFn: (join: JoinConfigurator<TResultShape, TRight>) => JoinConfiguratorResult<TResultShape, TRight, TAlias>
    ): MeshQueryBuilder<TItem, WithJoin<TResultShape, TAlias, TRight>> {
        
        const newJoins = [...this.joins, { right, config: configFn }];

        return new MeshQueryBuilder<TItem, WithJoin<TResultShape, TAlias, TRight>>(
            this.executor,
            this.query,
            {
                whereClauses: this.whereClauses,
                joins: newJoins,
                selectedFields: this.selectedFields as readonly (keyof WithJoin<TResultShape, TAlias, TRight>)[] | null,
                orderByClauses: this.orderByClauses,
                limitValue: this.limitValue,
                offsetValue: this.offsetValue,
                scope: this._scope,
            }
        );
    }
    
    async execute(): Promise<any[]> {
        return this.executor.execute(this);
    }
    
    // Streaming method as per v2 pattern
    async *stream(): AsyncIterable<any> {
        // In a real implementation, this would yield results as they come in
        const results = await this.execute();
        for (const result of results) {
            yield result;
        }
    }
}
