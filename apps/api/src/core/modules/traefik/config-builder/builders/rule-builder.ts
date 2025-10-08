import type { VariableString } from '../types/common.types';

/**
 * Rule matcher types for Traefik routing
 */
export type RuleMatcher =
  | 'Host'
  | 'HostRegexp'
  | 'Path'
  | 'PathPrefix'
  | 'Method'
  | 'Headers'
  | 'HeadersRegexp'
  | 'Query'
  | 'ClientIP';

/**
 * Logical operators for combining rules
 */
export type RuleOperator = '&&' | '||';

/**
 * Builder for creating Traefik routing rules
 */
export class RuleBuilder {
  private rules: string[] = [];
  private operator: RuleOperator = '&&';

  /**
   * Host matcher - matches request host
   * @example .host('example.com') → "Host(`example.com`)"
   * @example .host('~##domain##~') → "Host(`~##domain##~`)"
   */
  host(domain: VariableString): this {
    this.rules.push(`Host(\`${domain}\`)`);
    return this;
  }

  /**
   * HostRegexp matcher - matches request host with regex
   * @example .hostRegexp('{subdomain:[a-z]+}.example.com')
   */
  hostRegexp(pattern: VariableString): this {
    this.rules.push(`HostRegexp(\`${pattern}\`)`);
    return this;
  }

  /**
   * Path matcher - exact path match
   * @example .path('/api/users') → "Path(`/api/users`)"
   */
  path(path: VariableString): this {
    this.rules.push(`Path(\`${path}\`)`);
    return this;
  }

  /**
   * PathPrefix matcher - path prefix match
   * @example .pathPrefix('/api') → "PathPrefix(`/api`)"
   */
  pathPrefix(prefix: VariableString): this {
    this.rules.push(`PathPrefix(\`${prefix}\`)`);
    return this;
  }

  /**
   * Method matcher - HTTP method(s)
   * @example .method('GET', 'POST') → "Method(`GET`, `POST`)"
   */
  method(...methods: string[]): this {
    const methodList = methods.map(m => `\`${m}\``).join(', ');
    this.rules.push(`Method(${methodList})`);
    return this;
  }

  /**
   * Headers matcher - header key-value match
   * @example .header('X-API-Key', 'secret') → "Headers(`X-API-Key`, `secret`)"
   */
  header(key: string, value: VariableString): this {
    this.rules.push(`Headers(\`${key}\`, \`${value}\`)`);
    return this;
  }

  /**
   * HeadersRegexp matcher - header key-value match with regex
   */
  headerRegexp(key: string, pattern: VariableString): this {
    this.rules.push(`HeadersRegexp(\`${key}\`, \`${pattern}\`)`);
    return this;
  }

  /**
   * Query matcher - query parameter match
   * @example .query('version', 'v1') → "Query(`version`, `v1`)"
   */
  query(key: string, value: VariableString): this {
    this.rules.push(`Query(\`${key}\`, \`${value}\`)`);
    return this;
  }

  /**
   * ClientIP matcher - matches client IP
   * @example .clientIP('192.168.1.0/24') → "ClientIP(`192.168.1.0/24`)"
   */
  clientIP(cidr: VariableString): this {
    this.rules.push(`ClientIP(\`${cidr}\`)`);
    return this;
  }

  /**
   * Custom matcher - add custom rule
   * @example .custom('Custom(`value`)')
   */
  custom(rule: string): this {
    this.rules.push(rule);
    return this;
  }

  /**
   * AND operator - combine with AND logic
   * @example .host('example.com').and(r => r.pathPrefix('/api'))
   */
  and(builderOrFn: RuleBuilder | ((rb: RuleBuilder) => RuleBuilder)): this {
    const builder = typeof builderOrFn === 'function' 
      ? builderOrFn(new RuleBuilder())
      : builderOrFn;
    
    const subRule = builder.build();
    if (subRule) {
      this.rules.push(`(${subRule})`);
      this.operator = '&&';
    }
    return this;
  }

  /**
   * OR operator - combine with OR logic
   * @example .host('example.com').or(r => r.host('example.org'))
   */
  or(builderOrFn: RuleBuilder | ((rb: RuleBuilder) => RuleBuilder)): this {
    const builder = typeof builderOrFn === 'function'
      ? builderOrFn(new RuleBuilder())
      : builderOrFn;
    
    const subRule = builder.build();
    if (subRule) {
      this.rules.push(`(${subRule})`);
      this.operator = '||';
    }
    return this;
  }

  /**
   * Build the final rule string
   * @returns Traefik rule string
   */
  build(): string {
    if (this.rules.length === 0) {
      return '';
    }
    if (this.rules.length === 1) {
      return this.rules[0];
    }
    return this.rules.join(` ${this.operator} `);
  }

  /**
   * Create a rule from a template string
   * @example RuleBuilder.from('Host(`~##domain##~`) && Path(`/api`)')
   */
  static from(rule: VariableString): RuleBuilder {
    const builder = new RuleBuilder();
    builder.custom(rule);
    return builder;
  }

  /**
   * Combine multiple rules with AND
   */
  static and(...builders: RuleBuilder[]): RuleBuilder {
    const combined = new RuleBuilder();
    combined.operator = '&&';
    combined.rules = builders
      .map(b => b.build())
      .filter(r => r !== '')
      .map(r => `(${r})`);
    return combined;
  }

  /**
   * Combine multiple rules with OR
   */
  static or(...builders: RuleBuilder[]): RuleBuilder {
    const combined = new RuleBuilder();
    combined.operator = '||';
    combined.rules = builders
      .map(b => b.build())
      .filter(r => r !== '')
      .map(r => `(${r})`);
    return combined;
  }
}
