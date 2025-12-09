#!/usr/bin/env bun
/**
 * Master lint fixer - runs all available fix scripts
 *
 * Usage:
 *   List available fixers:
 *     bun run scripts/fix-all.ts --list
 *
 *   Dry run all fixers:
 *     bun run lint 2>&1 | bun run scripts/fix-all.ts --dry-run
 *
 *   Apply all fixers:
 *     bun run lint 2>&1 | bun run scripts/fix-all.ts --apply
 *
 *   Run specific fixers:
 *     bun run lint 2>&1 | bun run scripts/fix-all.ts --dry-run --only nullish,template
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function c(color: keyof typeof colors, text: string): string {
    return `${colors[color]}${text}${colors.reset}`;
}

interface Fixer {
    name: string;
    script: string;
    rule: string;
    description: string;
    safe: boolean; // Whether this is a very safe fix
}

const FIXERS: Fixer[] = [
    {
        name: 'nullish',
        script: 'fix-nullish-coalescing.ts',
        rule: '@typescript-eslint/prefer-nullish-coalescing',
        description: '|| → ?? (nullish coalescing)',
        safe: true,
    },
    {
        name: 'template',
        script: 'fix-template-expressions.ts',
        rule: '@typescript-eslint/restrict-template-expressions',
        description: 'Wrap number/Date in String() for template literals',
        safe: true,
    },
    {
        name: 'require-await',
        script: 'fix-require-await.ts',
        rule: '@typescript-eslint/require-await',
        description: 'Remove async from functions without await',
        safe: true,
    },
    {
        name: 'floating-promises',
        script: 'fix-floating-promises.ts',
        rule: '@typescript-eslint/no-floating-promises',
        description: 'Add void prefix to unhandled promises',
        safe: true,
    },
    {
        name: 'unused-vars',
        script: 'fix-unused-vars.ts',
        rule: '@typescript-eslint/no-unused-vars',
        description: 'Prefix unused variables with _',
        safe: true,
    },
    {
        name: 'case-declarations',
        script: 'fix-case-declarations.ts',
        rule: 'no-case-declarations',
        description: 'Wrap case blocks in {}',
        safe: true,
    },
    {
        name: 'empty-function',
        script: 'fix-empty-function.ts',
        rule: '@typescript-eslint/no-empty-function',
        description: 'Add comment to empty functions',
        safe: true,
    },
    {
        name: 'prefer-const',
        script: 'fix-prefer-const.ts',
        rule: 'prefer-const',
        description: 'Change let to const where possible',
        safe: true,
    },
];

function printList() {
    console.log(c('bold', '\nAvailable Lint Fixers\n'));
    console.log('─'.repeat(80));
    
    for (const fixer of FIXERS) {
        const safeLabel = fixer.safe ? c('green', '✓ Safe') : c('yellow', '⚠ Review');
        console.log(`\n  ${c('cyan', fixer.name)}`);
        console.log(`    Script:      ${fixer.script}`);
        console.log(`    Rule:        ${fixer.rule}`);
        console.log(`    Description: ${fixer.description}`);
        console.log(`    Safety:      ${safeLabel}`);
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log(c('dim', '\nUsage examples:'));
    console.log(c('dim', '  bun run lint 2>&1 | bun run scripts/fix-all.ts --dry-run'));
    console.log(c('dim', '  bun run lint 2>&1 | bun run scripts/fix-all.ts --apply'));
    console.log(c('dim', '  bun run lint 2>&1 | bun run scripts/fix-all.ts --dry-run --only nullish,template'));
    console.log();
}

async function runFixer(fixer: Fixer, lintOutput: string, mode: '--dry-run' | '--apply'): Promise<{
    success: boolean;
    output: string;
}> {
    const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
    const scriptPath = path.join(scriptsDir, fixer.script);
    
    if (!fs.existsSync(scriptPath)) {
        return {
            success: false,
            output: `Script not found: ${scriptPath}`,
        };
    }

    return new Promise((resolve) => {
        const child = spawn('bun', ['run', scriptPath, mode], {
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.stdin.write(lintOutput);
        child.stdin.end();

        child.on('close', (code) => {
            resolve({
                success: code === 0,
                output: stdout + stderr,
            });
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    const listMode = args.includes('--list');
    const dryRun = args.includes('--dry-run');
    const apply = args.includes('--apply');
    
    // Parse --only filter
    const onlyIndex = args.findIndex(a => a === '--only');
    let onlyFixers: string[] | null = null;
    if (onlyIndex !== -1 && args[onlyIndex + 1]) {
        onlyFixers = args[onlyIndex + 1].split(',').map(s => s.trim());
    }

    if (listMode) {
        printList();
        process.exit(0);
    }

    if (!dryRun && !apply) {
        console.log(c('yellow', 'Usage:'));
        console.log('  bun run scripts/fix-all.ts --list');
        console.log('  bun run lint 2>&1 | bun run scripts/fix-all.ts --dry-run');
        console.log('  bun run lint 2>&1 | bun run scripts/fix-all.ts --apply');
        console.log('  bun run lint 2>&1 | bun run scripts/fix-all.ts --dry-run --only nullish,template');
        process.exit(1);
    }

    // Read lint output from stdin
    let lintOutput = '';
    
    if (process.stdin.isTTY) {
        console.log(c('red', 'Error: No input provided. Pipe ESLint output to this script.'));
        console.log(c('dim', 'Example: bun run lint 2>&1 | bun run scripts/fix-all.ts --dry-run'));
        process.exit(1);
    }

    // Read all stdin
    for await (const chunk of process.stdin) {
        lintOutput += chunk;
    }

    const mode = apply ? '--apply' : '--dry-run';
    
    console.log(c('bold', `\n${'═'.repeat(80)}`));
    console.log(c('bold', `Running Lint Fixers (${mode})`));
    console.log(c('bold', '═'.repeat(80)));

    // Filter fixers if --only is specified
    let fixersToRun = FIXERS;
    if (onlyFixers) {
        fixersToRun = FIXERS.filter(f => onlyFixers!.includes(f.name));
        if (fixersToRun.length === 0) {
            console.log(c('red', `\nNo fixers match: ${onlyFixers.join(', ')}`));
            console.log(c('dim', 'Available fixers: ' + FIXERS.map(f => f.name).join(', ')));
            process.exit(1);
        }
    }

    const results: Array<{ fixer: Fixer; success: boolean; summary: string }> = [];

    for (const fixer of fixersToRun) {
        console.log(c('bold', `\n─── ${fixer.name} ───`));
        console.log(c('dim', `Rule: ${fixer.rule}`));
        
        const result = await runFixer(fixer, lintOutput, mode);
        
        // Extract summary from output
        const summaryMatch = result.output.match(/Total errors:\s+(\d+)/);
        const fixableMatch = result.output.match(/Fixable:\s+(\d+)/);
        const appliedMatch = result.output.match(/Applied (\d+) fixes/);
        
        let summary = '';
        if (summaryMatch) {
            const total = summaryMatch[1];
            const fixable = fixableMatch ? fixableMatch[1] : '0';
            const applied = appliedMatch ? appliedMatch[1] : '0';
            
            if (apply) {
                summary = `${applied}/${total} fixed`;
            } else {
                summary = `${fixable}/${total} fixable`;
            }
        } else if (result.output.includes('No ')) {
            summary = 'No errors';
        } else {
            summary = result.success ? 'OK' : 'Error';
        }
        
        results.push({ fixer, success: result.success, summary });
        
        // Only show detailed output if there are errors to fix
        if (!result.output.includes('No ') && !result.output.includes('✓')) {
            // Show a condensed version of the output
            const lines = result.output.split('\n');
            const previewLines = lines.slice(0, 20);
            console.log(previewLines.join('\n'));
            if (lines.length > 20) {
                console.log(c('dim', `... and ${lines.length - 20} more lines`));
            }
        } else {
            console.log(result.output.trim());
        }
    }

    // Final summary
    console.log(c('bold', `\n${'═'.repeat(80)}`));
    console.log(c('bold', 'FINAL SUMMARY'));
    console.log(c('bold', '═'.repeat(80)));
    console.log();
    
    for (const result of results) {
        const status = result.success ? c('green', '✓') : c('red', '✗');
        console.log(`  ${status} ${result.fixer.name.padEnd(20)} ${result.summary}`);
    }
    
    console.log();
    
    if (dryRun) {
        console.log(c('cyan', '💡 Run with --apply to apply all fixes'));
    }
}

main().catch(console.error);
