#!/usr/bin/env bun
/**
 * ESLint Error Analysis Script
 *
 * Usage:
 *   Analyze all errors:
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts
 *
 *   Filter by specific rule(s) - space or comma separated:
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts require-await
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts require-await no-floating-promises
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts require-await,no-floating-promises
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts @typescript-eslint/no-unsafe-member-access
 *
 *   List available rules:
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts --list
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts --list --json
 *
 *   Short output (one line per error):
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts require-await --short
 *
 *   JSON output:
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts require-await --json
 *     bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts --list --json
 *
 * This script will:
 *   1. Parse all ESLint errors
 *   2. Group them by rule
 *   3. Show count and examples for each rule
 *   4. When filtering by rule(s), show detailed file/line info with code context
 */

import * as readline from 'readline';
import * as fs from 'fs';

interface ErrorInfo {
    file: string;
    line: number;
    col: number;
    severity: string;
    message: string;
    rule: string;
}

interface RuleSummary {
    rule: string;
    count: number;
    examples: ErrorInfo[];
    errors: ErrorInfo[];
    files: Set<string>;
}

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
};

function c(color: keyof typeof colors, text: string): string {
    return `${colors[color]}${text}${colors.reset}`;
}

// Rules that can potentially be auto-fixed with a script
const SCRIPTABLE_FIXES: Record<string, string> = {
    '@typescript-eslint/prefer-nullish-coalescing': '|| → ?? (already have script)',
    '@typescript-eslint/restrict-template-expressions': 'Wrap with String() for number/Date (already have script)',
    '@typescript-eslint/no-unnecessary-condition': 'Remove unnecessary conditions',
    '@typescript-eslint/no-empty-function': 'Add // empty comment or remove',
    '@typescript-eslint/require-await': 'Remove async or add await',
    '@typescript-eslint/no-floating-promises': 'Add void or await',
    '@typescript-eslint/no-misused-promises': 'Fix promise handling',
    'no-case-declarations': 'Wrap case block in {}',
    '@typescript-eslint/no-unused-vars': 'Remove or prefix with _',
    'prefer-const': 'Change let to const',
    '@typescript-eslint/explicit-function-return-type': 'Add return type annotation',
    '@typescript-eslint/no-inferrable-types': 'Remove type annotation',
};

// Rules that need manual review (unsafe to auto-fix)
const MANUAL_REVIEW_RULES = [
    '@typescript-eslint/no-unsafe-assignment',
    '@typescript-eslint/no-unsafe-member-access',
    '@typescript-eslint/no-unsafe-call',
    '@typescript-eslint/no-unsafe-return',
    '@typescript-eslint/no-unsafe-argument',
    '@typescript-eslint/no-explicit-any',
    '@typescript-eslint/use-unknown-in-catch-callback-variable',
];

function getRelativePath(filePath: string): string {
    const cwd = process.cwd();
    if (filePath.startsWith(cwd)) {
        return filePath.slice(cwd.length + 1);
    }
    return filePath;
}

function getCodeContext(filePath: string, line: number, col: number): string[] {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const result: string[] = [];

        const startLine = Math.max(0, line - 3);
        const endLine = Math.min(lines.length - 1, line + 1);

        for (let i = startLine; i <= endLine; i++) {
            const lineNum = (i + 1).toString().padStart(4, ' ');
            const isErrorLine = i + 1 === line;
            const lineContent = lines[i] || '';

            if (isErrorLine) {
                result.push(`${c('red', '>')} ${c('dim', lineNum)} │ ${lineContent}`);
                // Add column indicator
                const indicator = ' '.repeat(Math.max(0, col - 1)) + c('red', '^');
                result.push(`  ${' '.repeat(4)} │ ${indicator}`);
            } else {
                result.push(`  ${c('dim', lineNum)} │ ${c('dim', lineContent)}`);
            }
        }

        return result;
    } catch {
        return [`  ${c('dim', '(unable to read file)')}`];
    }
}

function getCategoryInfo(rule: string): { icon: string; label: string; color: keyof typeof colors } {
    if (SCRIPTABLE_FIXES[rule]) {
        return { icon: '🔧', label: 'Scriptable', color: 'green' };
    } else if (MANUAL_REVIEW_RULES.includes(rule)) {
        return { icon: '⚠️', label: 'Manual Review', color: 'yellow' };
    }
    return { icon: '📋', label: 'Other', color: 'blue' };
}

function printRuleDetails(summaries: RuleSummary[], jsonMode: boolean, shortMode: boolean) {
    // Merge all errors from all summaries
    const allErrors: ErrorInfo[] = [];
    const allFiles = new Set<string>();
    const rules: string[] = [];

    for (const summary of summaries) {
        rules.push(summary.rule);
        for (const error of summary.errors) {
            allErrors.push(error);
            allFiles.add(error.file);
        }
    }

    // JSON mode
    if (jsonMode) {
        const output = {
            rules,
            totalErrors: allErrors.length,
            filesAffected: allFiles.size,
            errors: allErrors.map((e) => ({
                rule: e.rule,
                file: getRelativePath(e.file),
                line: e.line,
                col: e.col,
                message: e.message,
                severity: e.severity,
            })),
        };
        console.log(JSON.stringify(output, null, 2));
        return;
    }

    // Short mode: one line per error
    if (shortMode) {
        // Sort by file, then line
        allErrors.sort((a, b) => {
            const fileCompare = a.file.localeCompare(b.file);
            if (fileCompare !== 0) return fileCompare;
            return a.line - b.line;
        });

        for (const error of allErrors) {
            const relativePath = getRelativePath(error.file);
            console.log(`${c('cyan', error.rule)}|${c('blue', relativePath)}:${c('yellow', `${error.line}:${error.col}`)}`);
        }
        return;
    }

    // Full detailed mode
    const rulesStr = rules.map((r) => c('cyan', r)).join(', ');

    console.log();
    console.log(c('bold', '═'.repeat(80)));
    console.log(c('bold', `Rules: ${rulesStr}`));
    console.log(c('bold', '═'.repeat(80)));
    console.log();

    // Show category for each rule
    for (const summary of summaries) {
        const category = getCategoryInfo(summary.rule);
        console.log(`  ${c('bold', summary.rule)}`);
        console.log(`    ${c('bold', 'Category:')}    ${category.icon} ${c(category.color, category.label)}`);
        console.log(`    ${c('bold', 'Errors:')}      ${c('yellow', String(summary.count))}`);
        if (SCRIPTABLE_FIXES[summary.rule]) {
            console.log(`    ${c('bold', 'Fix hint:')}    ${c('green', SCRIPTABLE_FIXES[summary.rule])}`);
        }
        console.log();
    }

    console.log(`  ${c('bold', 'Total:')}       ${c('yellow', String(allErrors.length))} errors`);
    console.log(`  ${c('bold', 'Files:')}       ${allFiles.size} files affected`);
    console.log();

    // Group errors by file
    const errorsByFile = new Map<string, ErrorInfo[]>();
    for (const error of allErrors) {
        if (!errorsByFile.has(error.file)) {
            errorsByFile.set(error.file, []);
        }
        errorsByFile.get(error.file)!.push(error);
    }

    // Sort files by error count
    const sortedFiles = [...errorsByFile.entries()].sort((a, b) => b[1].length - a[1].length);

    console.log(c('bold', '─'.repeat(80)));
    console.log(c('bold', 'ERRORS BY FILE'));
    console.log(c('bold', '─'.repeat(80)));

    for (const [file, fileErrors] of sortedFiles) {
        const relativePath = getRelativePath(file);
        console.log();
        console.log(
            `${c('bold', c('blue', '📄 ' + relativePath))} ${c('dim', `(${fileErrors.length} error${fileErrors.length > 1 ? 's' : ''})`)}`
        );
        console.log();

        // Sort errors by line number
        fileErrors.sort((a, b) => a.line - b.line);

        for (const error of fileErrors) {
            console.log(`  ${c('cyan', `[${error.rule}]`)} ${c('yellow', `Line ${error.line}:${error.col}`)} ${c('dim', '─')} ${error.message}`);
            console.log();

            const context = getCodeContext(error.file, error.line, error.col);
            for (const line of context) {
                console.log(`    ${line}`);
            }
            console.log();
        }
    }

    // Summary
    console.log(c('bold', '─'.repeat(80)));
    console.log(c('bold', 'SUMMARY'));
    console.log(c('bold', '─'.repeat(80)));
    console.log();
    console.log(`  Total: ${c('yellow', String(allErrors.length))} errors in ${allFiles.size} files`);
    console.log();

    // Quick fix commands if applicable
    for (const summary of summaries) {
        if (summary.rule === '@typescript-eslint/prefer-nullish-coalescing') {
            console.log(c('green', `  💡 Quick fix available for ${summary.rule}:`));
            console.log(`     ${c('cyan', 'bun run lint 2>&1 | bun run scripts/fix-nullish-coalescing.ts --dry-run')}`);
            console.log(`     ${c('cyan', 'bun run lint 2>&1 | bun run scripts/fix-nullish-coalescing.ts --apply')}`);
            console.log();
        } else if (summary.rule === '@typescript-eslint/restrict-template-expressions') {
            console.log(c('green', `  💡 Quick fix available for ${summary.rule} (for number/Date only):`));
            console.log(`     ${c('cyan', 'bun run lint 2>&1 | bun run scripts/fix-template-expressions.ts --dry-run')}`);
            console.log(`     ${c('cyan', 'bun run lint 2>&1 | bun run scripts/fix-template-expressions.ts --apply')}`);
            console.log();
        }
    }
}

function printRuleList(ruleMap: Map<string, RuleSummary>, jsonMode: boolean) {
    const sortedRules = Array.from(ruleMap.values()).sort((a, b) => b.count - a.count);

    if (jsonMode) {
        const output = {
            totalRules: sortedRules.length,
            totalErrors: sortedRules.reduce((sum, r) => sum + r.count, 0),
            rules: sortedRules.map((summary) => ({
                rule: summary.rule,
                count: summary.count,
                filesAffected: summary.files.size,
                category: getCategoryInfo(summary.rule).label,
                fixHint: SCRIPTABLE_FIXES[summary.rule] || null,
            })),
        };
        console.log(JSON.stringify(output, null, 2));
        return;
    }

    console.log();
    console.log(c('bold', '═'.repeat(80)));
    console.log(c('bold', 'AVAILABLE RULES'));
    console.log(c('bold', '═'.repeat(80)));
    console.log();
    console.log(`  ${c('dim', 'Usage: bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts <rule1> [rule2...] or <rule1,rule2,...>')}`);
    console.log(`  ${c('dim', '       Rules can be space or comma separated. Partial matches are supported.')}`);
    console.log();
    console.log(c('bold', '─'.repeat(80)));
    console.log();

    for (const summary of sortedRules) {
        const category = getCategoryInfo(summary.rule);
        const count = String(summary.count).padStart(5);
        console.log(`  ${category.icon} ${c('yellow', count)} │ ${summary.rule}`);
    }

    console.log();
    console.log(c('dim', '  Legend: 🔧 Scriptable  ⚠️ Manual Review  📋 Other'));
    console.log();
}

function printFullAnalysis(errors: ErrorInfo[], ruleMap: Map<string, RuleSummary>) {
    const sortedRules = Array.from(ruleMap.values()).sort((a, b) => b.count - a.count);

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('ESLint Error Analysis');
    console.log('='.repeat(80));
    console.log(`\nTotal errors: ${errors.length}`);
    console.log(`Unique rules: ${sortedRules.length}`);
    console.log(`Files affected: ${new Set(errors.map((e) => e.file)).size}`);

    // Categorize rules
    const scriptable: RuleSummary[] = [];
    const manualReview: RuleSummary[] = [];
    const other: RuleSummary[] = [];

    for (const summary of sortedRules) {
        if (SCRIPTABLE_FIXES[summary.rule]) {
            scriptable.push(summary);
        } else if (MANUAL_REVIEW_RULES.includes(summary.rule)) {
            manualReview.push(summary);
        } else {
            other.push(summary);
        }
    }

    // Print scriptable fixes
    console.log('\n' + '-'.repeat(80));
    console.log('🔧 POTENTIALLY SCRIPTABLE FIXES');
    console.log('-'.repeat(80));

    let scriptableTotal = 0;
    for (const summary of scriptable) {
        scriptableTotal += summary.count;
        const fix = SCRIPTABLE_FIXES[summary.rule] || '';
        console.log(`\n  ${summary.rule}`);
        console.log(`    Count: ${summary.count} | Files: ${summary.files.size}`);
        console.log(`    Fix: ${fix}`);
        console.log(`    Example: ${summary.examples[0]?.message.substring(0, 80)}...`);
    }
    console.log(`\n  📊 Subtotal: ${scriptableTotal} errors could potentially be auto-fixed`);

    // Print manual review
    console.log('\n' + '-'.repeat(80));
    console.log('⚠️  REQUIRES MANUAL REVIEW (type safety issues)');
    console.log('-'.repeat(80));

    let manualTotal = 0;
    for (const summary of manualReview) {
        manualTotal += summary.count;
        console.log(`\n  ${summary.rule}`);
        console.log(`    Count: ${summary.count} | Files: ${summary.files.size}`);
        console.log(`    Example: ${summary.examples[0]?.message.substring(0, 80)}...`);
    }
    console.log(`\n  📊 Subtotal: ${manualTotal} errors need manual review`);

    // Print other
    console.log('\n' + '-'.repeat(80));
    console.log('📋 OTHER RULES');
    console.log('-'.repeat(80));

    let otherTotal = 0;
    for (const summary of other) {
        otherTotal += summary.count;
        console.log(`\n  ${summary.rule}`);
        console.log(`    Count: ${summary.count} | Files: ${summary.files.size}`);
        console.log(`    Example: ${summary.examples[0]?.message.substring(0, 80)}...`);
    }
    console.log(`\n  📊 Subtotal: ${otherTotal} errors`);

    // Print detailed breakdown table
    console.log('\n' + '='.repeat(80));
    console.log('DETAILED BREAKDOWN (sorted by count)');
    console.log('='.repeat(80));
    console.log('\n| Count | Files | Rule | Category |');
    console.log('|-------|-------|------|----------|');

    for (const summary of sortedRules) {
        let category = '📋 Other';
        if (SCRIPTABLE_FIXES[summary.rule]) {
            category = '🔧 Scriptable';
        } else if (MANUAL_REVIEW_RULES.includes(summary.rule)) {
            category = '⚠️ Manual';
        }
        console.log(
            `| ${String(summary.count).padStart(5)} | ${String(summary.files.size).padStart(5)} | ${summary.rule} | ${category} |`
        );
    }

    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(
        `\n  🔧 Scriptable:     ${scriptableTotal} errors (${((scriptableTotal / errors.length) * 100).toFixed(1)}%)`
    );
    console.log(
        `  ⚠️  Manual Review:  ${manualTotal} errors (${((manualTotal / errors.length) * 100).toFixed(1)}%)`
    );
    console.log(`  📋 Other:          ${otherTotal} errors (${((otherTotal / errors.length) * 100).toFixed(1)}%)`);
    console.log(`  ─────────────────────────────`);
    console.log(`  Total:             ${errors.length} errors`);
    console.log();
    console.log(c('dim', '  Tip: Run with a rule name to see detailed errors:'));
    console.log(c('dim', '       bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts <rule-name>'));
    console.log(c('dim', '       bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts --list'));
}

async function main() {
    const args = process.argv.slice(2);
    // Support both space-separated and comma-separated rules
    // e.g., "rule1 rule2" or "rule1,rule2" or "rule1, rule2"
    const ruleFilters = args
        .filter((arg) => !arg.startsWith('--'))
        .flatMap((arg) => arg.split(',').map((r) => r.trim()).filter(Boolean));
    const listMode = args.includes('--list');
    const jsonMode = args.includes('--json');
    const shortMode = args.includes('--short');

    const errors: ErrorInfo[] = [];
    let currentFile = '';

    const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
    });

    // Parse ESLint output
    for await (const line of rl) {
        // Check if this is a file path line
        const fileMatch = line.match(/^(\/[^\s]+\.tsx?)$/);
        if (fileMatch) {
            currentFile = fileMatch[1];
            continue;
        }

        // Parse error line: "  127:34  error  Message  rule-name"
        const errorMatch = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/);
        if (errorMatch && currentFile) {
            errors.push({
                file: currentFile,
                line: parseInt(errorMatch[1], 10),
                col: parseInt(errorMatch[2], 10),
                severity: errorMatch[3],
                message: errorMatch[4].trim(),
                rule: errorMatch[5],
            });
        }
    }

    if (errors.length === 0) {
        if (jsonMode) {
            console.log(JSON.stringify({ errors: [], totalErrors: 0 }));
        } else {
            console.log(c('green', '✓ No ESLint errors found!'));
            console.log(c('dim', 'Usage: bun run lint 2>&1 | bun run scripts/analyze-lint-errors.ts'));
        }
        process.exit(0);
    }

    // Group by rule
    const ruleMap = new Map<string, RuleSummary>();

    for (const error of errors) {
        let summary = ruleMap.get(error.rule);
        if (!summary) {
            summary = {
                rule: error.rule,
                count: 0,
                examples: [],
                errors: [],
                files: new Set(),
            };
            ruleMap.set(error.rule, summary);
        }

        summary.count++;
        summary.files.add(error.file);
        summary.errors.push(error);
        if (summary.examples.length < 3) {
            summary.examples.push(error);
        }
    }

    // Handle --list mode
    if (listMode) {
        printRuleList(ruleMap, jsonMode);
        return;
    }

    // Handle rule filter mode (one or multiple rules)
    if (ruleFilters.length > 0) {
        const allRuleKeys = Array.from(ruleMap.keys());
        const matchedSummaries: RuleSummary[] = [];

        for (const filter of ruleFilters) {
            // Find matching rule (support partial match)
            const matchingRules = allRuleKeys.filter(
                (rule) => rule === filter || rule.toLowerCase().includes(filter.toLowerCase())
            );

            if (matchingRules.length === 0) {
                if (!jsonMode) {
                    console.log(c('red', `✗ No rule found matching: ${filter}`));
                }
                continue;
            }

            // If multiple matches and exact match exists, use exact match
            if (matchingRules.length > 1 && matchingRules.includes(filter)) {
                matchedSummaries.push(ruleMap.get(filter)!);
            } else if (matchingRules.length === 1) {
                matchedSummaries.push(ruleMap.get(matchingRules[0])!);
            } else {
                // Multiple matches, no exact match
                if (!jsonMode) {
                    console.log(c('yellow', `⚠ Multiple rules match "${filter}":`));
                    for (const rule of matchingRules) {
                        const summary = ruleMap.get(rule)!;
                        console.log(`  - ${rule} (${summary.count} errors)`);
                    }
                    console.log();
                    console.log(c('dim', 'Please be more specific or use the exact rule name.'));
                }
            }
        }

        if (matchedSummaries.length === 0) {
            if (jsonMode) {
                console.log(JSON.stringify({ errors: [], totalErrors: 0, message: 'No matching rules found' }));
            } else {
                console.log();
                console.log(c('dim', 'Available rules:'));
                for (const rule of allRuleKeys.sort()) {
                    console.log(`  - ${rule}`);
                }
            }
            process.exit(1);
        }

        printRuleDetails(matchedSummaries, jsonMode, shortMode);
        return;
    }

    // Default: full analysis
    printFullAnalysis(errors, ruleMap);
}

main().catch(console.error);
