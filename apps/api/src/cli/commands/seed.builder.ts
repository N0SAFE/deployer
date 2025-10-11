/**
 * SeedBuilder - Fluent builder pattern for seed command operations
 * 
 * This builder allows chaining seed operations with context accumulation.
 * Each .use() call accepts a function that receives the current context
 * and returns updated context.
 * 
 * Example usage:
 * ```typescript
 * await this.builder()
 *   .use(this.createUsers)
 *   .use(this.createOrganization)
 *   .use(this.createProjects)
 *   .build()
 * ```
 */

/**
 * Type for a seed operation function
 * Takes current context and returns a promise of updated context
 */
type SeedOperation<TContext, TNewContext> = (
  context: TContext
) => Promise<TNewContext>;

/**
 * Builder class that chains seed operations with context accumulation
 */
export class SeedBuilder<TContext = {}> {
  private operations: Array<(context: any) => Promise<any>> = [];
  private initialContext: TContext;

  constructor(initialContext: TContext = {} as TContext) {
    this.initialContext = initialContext;
  }

  /**
   * Add a seed operation to the chain
   * 
   * @param operation - Function that takes current context and returns updated context
   * @returns New builder instance with the operation added
   * 
   * @example
   * ```typescript
   * builder.use(async (ctx) => {
   *   const users = await createUsers();
   *   return { ...ctx, users };
   * })
   * ```
   */
  use<TNewContext>(
    operation: SeedOperation<TContext, TNewContext>
  ): SeedBuilder<TNewContext> {
    const newBuilder = new SeedBuilder<TNewContext>(this.initialContext as any);
    newBuilder.operations = [...this.operations, operation];
    return newBuilder;
  }

  /**
   * Execute all chained operations in sequence
   * 
   * @returns Final context after all operations
   * 
   * @example
   * ```typescript
   * const finalContext = await builder
   *   .use(operation1)
   *   .use(operation2)
   *   .build();
   * ```
   */
  async build(): Promise<TContext> {
    let context: any = this.initialContext;

    for (const operation of this.operations) {
      context = await operation(context);
    }

    return context;
  }

  /**
   * Create a new builder instance with initial context
   * 
   * @param initialContext - Starting context for the builder
   * @returns New builder instance
   */
  static create<TInitialContext>(
    initialContext?: TInitialContext
  ): SeedBuilder<TInitialContext extends undefined ? {} : TInitialContext> {
    return new SeedBuilder(initialContext ?? ({} as any));
  }
}
