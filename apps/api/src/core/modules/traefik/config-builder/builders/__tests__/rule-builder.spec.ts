import { describe, it, expect } from 'vitest';
import { RuleBuilder } from '../rule-builder';

describe('RuleBuilder', () => {
  describe('Basic Matchers', () => {
    it('should build a host rule', () => {
      const rule = new RuleBuilder().host('example.com').build();
      expect(rule).toBe('Host(`example.com`)');
    });

    it('should build a host rule with variable', () => {
      const rule = new RuleBuilder().host('~##domain##~').build();
      expect(rule).toBe('Host(`~##domain##~`)');
    });

    it('should build a pathPrefix rule', () => {
      const rule = new RuleBuilder().pathPrefix('/api').build();
      expect(rule).toBe('PathPrefix(`/api`)');
    });

    it('should build a path rule', () => {
      const rule = new RuleBuilder().path('/health').build();
      expect(rule).toBe('Path(`/health`)');
    });

    it('should build a method rule', () => {
      const rule = new RuleBuilder().method('GET', 'POST').build();
      expect(rule).toBe('Method(`GET`, `POST`)');
    });

    it('should build a header rule', () => {
      const rule = new RuleBuilder().header('X-API-Key', 'secret').build();
      expect(rule).toBe('Headers(`X-API-Key`, `secret`)');
    });

    it('should build a query rule', () => {
      const rule = new RuleBuilder().query('token', '~##apiToken##~').build();
      expect(rule).toBe('Query(`token`, `~##apiToken##~`)');
    });

    it('should build a clientIP rule', () => {
      const rule = new RuleBuilder().clientIP('192.168.1.0/24').build();
      expect(rule).toBe('ClientIP(`192.168.1.0/24`)');
    });
  });

  describe('Logical Operators - AND', () => {
    it('should combine rules with AND using method chaining', () => {
      const rule = new RuleBuilder()
        .host('example.com')
        .and(rb => rb.pathPrefix('/api'))
        .build();
      expect(rule).toBe('Host(`example.com`) && (PathPrefix(`/api`))');
    });

    it('should combine rules with AND using builder instance', () => {
      const pathRule = new RuleBuilder().pathPrefix('/api');
      const rule = new RuleBuilder()
        .host('example.com')
        .and(pathRule)
        .build();
      expect(rule).toBe('Host(`example.com`) && (PathPrefix(`/api`))');
    });

    it('should combine multiple rules with AND', () => {
      const rule = new RuleBuilder()
        .host('~##domain##~')
        .and(rb => rb.pathPrefix('/api'))
        .and(rb => rb.method('GET'))
        .build();
      expect(rule).toBe('Host(`~##domain##~`) && (PathPrefix(`/api`)) && (Method(`GET`))');
    });

    it('should use static and() helper', () => {
      const rule = RuleBuilder.and(
        new RuleBuilder().host('example.com'),
        new RuleBuilder().pathPrefix('/api')
      ).build();
      expect(rule).toBe('(Host(`example.com`)) && (PathPrefix(`/api`))');
    });
  });

  describe('Logical Operators - OR', () => {
    it('should combine rules with OR using method chaining', () => {
      const rule = new RuleBuilder()
        .host('example.com')
        .or(rb => rb.host('www.example.com'))
        .build();
      expect(rule).toBe('Host(`example.com`) || (Host(`www.example.com`))');
    });

    it('should combine rules with OR using builder instance', () => {
      const altHost = new RuleBuilder().host('www.example.com');
      const rule = new RuleBuilder()
        .host('example.com')
        .or(altHost)
        .build();
      expect(rule).toBe('Host(`example.com`) || (Host(`www.example.com`))');
    });

    it('should combine multiple rules with OR', () => {
      const rule = new RuleBuilder()
        .host('api.example.com')
        .or(rb => rb.host('staging-api.example.com'))
        .or(rb => rb.host('dev-api.example.com'))
        .build();
      expect(rule).toBe('Host(`api.example.com`) || (Host(`staging-api.example.com`)) || (Host(`dev-api.example.com`))');
    });

    it('should use static or() helper', () => {
      const rule = RuleBuilder.or(
        new RuleBuilder().host('example.com'),
        new RuleBuilder().host('www.example.com')
      ).build();
      expect(rule).toBe('(Host(`example.com`)) || (Host(`www.example.com`))');
    });
  });

  describe('Complex Combinations', () => {
    it('should combine AND and OR operators', () => {
      const rule = new RuleBuilder()
        .host('example.com')
        .and(rb => rb.pathPrefix('/api'))
        .or(rb => rb.host('api.example.com'))
        .build();
      // Note: Last operator wins, this becomes OR
      expect(rule).toBe('Host(`example.com`) || (PathPrefix(`/api`)) || (Host(`api.example.com`))');
    });

    it('should handle nested logical operations', () => {
      const apiRule = RuleBuilder.and(
        new RuleBuilder().host('~##domain##~'),
        new RuleBuilder().pathPrefix('/api')
      );
      
      const adminRule = RuleBuilder.and(
        new RuleBuilder().host('~##domain##~'),
        new RuleBuilder().pathPrefix('/admin')
      );
      
      const rule = RuleBuilder.or(apiRule, adminRule).build();
      expect(rule).toBe('((Host(`~##domain##~`)) && (PathPrefix(`/api`))) || ((Host(`~##domain##~`)) && (PathPrefix(`/admin`)))');
    });

    it('should build complex real-world routing rule', () => {
      const rule = new RuleBuilder()
        .host('~##domain##~')
        .and(rb => rb.pathPrefix('/api'))
        .and(rb => rb.method('GET', 'POST'))
        .build();
      expect(rule).toBe('Host(`~##domain##~`) && (PathPrefix(`/api`)) && (Method(`GET`, `POST`))');
    });
  });

  describe('Static from() Method', () => {
    it('should create RuleBuilder from existing rule string', () => {
      const rule = RuleBuilder.from('Host(`example.com`)').build();
      expect(rule).toBe('Host(`example.com`)');
    });

    it('should allow extending rule from string', () => {
      const rule = RuleBuilder.from('Host(`example.com`)')
        .and(rb => rb.pathPrefix('/api'))
        .build();
      expect(rule).toBe('Host(`example.com`) && (PathPrefix(`/api`))');
    });

    it('should handle complex rule strings with variables', () => {
      const rule = RuleBuilder.from('Host(`~##domain##~`) && PathPrefix(`/api`)').build();
      expect(rule).toBe('Host(`~##domain##~`) && PathPrefix(`/api`)');
    });
  });

  describe('Variable Support', () => {
    it('should support variables in host', () => {
      const rule = new RuleBuilder().host('~##apiDomain##~').build();
      expect(rule).toBe('Host(`~##apiDomain##~`)');
    });

    it('should support variables in pathPrefix', () => {
      const rule = new RuleBuilder().pathPrefix('~##basePath##~').build();
      expect(rule).toBe('PathPrefix(`~##basePath##~`)');
    });

    it('should support variables in header values', () => {
      const rule = new RuleBuilder().header('X-API-Key', '~##apiKey##~').build();
      expect(rule).toBe('Headers(`X-API-Key`, `~##apiKey##~`)');  
    });    it('should support multiple variables in complex rules', () => {
      const rule = new RuleBuilder()
        .host('~##domain##~')
        .and(rb => rb.pathPrefix('~##apiPath##~'))
        .and(rb => rb.header('X-Version', '~##apiVersion##~'))
        .build();
      expect(rule).toBe('Host(`~##domain##~`) && (PathPrefix(`~##apiPath##~`)) && (Headers(`X-Version`, `~##apiVersion##~`))'); 
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty builder', () => {
      const rule = new RuleBuilder().build();
      expect(rule).toBe('');
    });

    it('should handle special characters in values', () => {
      const rule = new RuleBuilder().path('/api/v1/{id}').build();
      expect(rule).toBe('Path(`/api/v1/{id}`)');
    });

    it('should handle multiple methods', () => {
      const rule = new RuleBuilder().method('GET', 'POST', 'PUT', 'DELETE').build();
      expect(rule).toBe('Method(`GET`, `POST`, `PUT`, `DELETE`)');
    });

    it('should handle CIDR notation in clientIP', () => {
      const rule = new RuleBuilder().clientIP('10.0.0.0/8').build();
      expect(rule).toBe('ClientIP(`10.0.0.0/8`)');
    });
  });
});
