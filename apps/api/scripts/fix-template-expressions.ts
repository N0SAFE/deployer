#!/usr/bin/env bun
/**
 * Script to fix restrict-template-expressions errors by wrapping expressions with String()
 * 
 * Usage:
 *   bun run lint 2>&1 | bun run scripts/fix-template-expressions.ts [--dry-run]
 *   
 * Options:
 *   --dry-run    Show what would be changed without modifying files (default)
 *   --apply      Actually apply the changes
 * 
 * This script handles errors like:
 *   - Invalid type "number" of template literal expression
 *   - Invalid type "string | undefined" of template literal expression
 *   - Invalid type "any" of template literal expression
 *   - etc.
 * 
 * It wraps the expression inside ${} with String(), e.g.:
 *   `value is ${num}` -> `value is ${String(num)}`
 */

import * as fs from 'fs';
import * as readline from 'readline';

interface Change {
    file: string;
    line: number;
    col: number;
    invalidType: string;
}

const isDryRun = !process.argv.includes('--apply');

// Types that should be wrapped with String()
// Only safe, predictable types - NOT any, unknown, never, undefined, null
const SAFE_TYPES_TO_FIX = [
    'number',
    'Date',
    'bigint',
];

// Types we should NEVER auto-fix (require manual review)
const SKIP_TYPES = [
    'any',
    'unknown',
    'never',
    'undefined',
    'null',
    'object',
    'symbol',
];

function shouldFixType(typeStr: string): boolean {
    const cleanType = typeStr.replace(/"/g, '').trim();
    
    // Skip if it contains any dangerous types
    for (const skipType of SKIP_TYPES) {
        if (cleanType === skipType || cleanType.includes(` ${skipType}`) || cleanType.includes(`${skipType} `)) {
            return false;
        }
    }
    
    // Also skip union types that contain undefined/null (e.g., "string | undefined")
    if (cleanType.includes('|')) {
        const parts = cleanType.split('|').map(p => p.trim());
        if (parts.some(p => SKIP_TYPES.includes(p))) {
            return false;
        }
    }
    
    // Only fix if it's a safe type
    return SAFE_TYPES_TO_FIX.some(t => cleanType === t || cleanType.includes(t));
}

function findExpressionBounds(line: string, startCol: number): { start: number; end: number; expr: string } | null {
    // The column points to inside the ${}, we need to find the full expression
    // Look backwards for ${ and forwards for }
    
    // First, find the ${ before the column
    let dollarBraceStart = -1;
    for (let i = startCol - 1; i >= 0; i--) {
        if (line[i] === '{' && i > 0 && line[i - 1] === '$') {
            dollarBraceStart = i - 1;
            break;
        }
    }
    
    if (dollarBraceStart === -1) {
        // Column might be exactly at the expression start, look for ${ right before
        const before = line.substring(0, startCol);
        const lastDollarBrace = before.lastIndexOf('${');
        if (lastDollarBrace !== -1) {
            dollarBraceStart = lastDollarBrace;
        } else {
            return null;
        }
    }
    
    // Find the matching closing brace
    let braceCount = 0;
    let closingBrace = -1;
    for (let i = dollarBraceStart + 2; i < line.length; i++) {
        const char = line[i];
        if (char === '{') {
            braceCount++;
        } else if (char === '}') {
            if (braceCount === 0) {
                closingBrace = i;
                break;
            }
            braceCount--;
        }
    }
    
    if (closingBrace === -1) {
        return null;
    }
    
    const expr = line.substring(dollarBraceStart + 2, closingBrace);
    return {
        start: dollarBraceStart + 2, // Position after ${
        end: closingBrace,           // Position of }
        expr: expr,
    };
}

function isAlreadyWrapped(expr: string): boolean {
    const trimmed = expr.trim();
    // Check if already wrapped with String()
    if (trimmed.startsWith('String(') && trimmed.endsWith(')')) {
        return true;
    }
    // Check if it's a .toString() call
    if (trimmed.endsWith('.toString()')) {
        return true;
    }
    // Check if it's JSON.stringify
    if (trimmed.startsWith('JSON.stringify(')) {
        return true;
    }
    return false;
}

async function main() {
    const changes: Change[] = [];
    let currentFile = '';

    const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
    });

    // Parse ESLint output
    for await (const line of rl) {
        // Check if this is a file path line (starts with / and ends with .ts)
        const fileMatch = line.match(/^(\/[^\s]+\.tsx?)$/);
        if (fileMatch) {
            currentFile = fileMatch[1];
            continue;
        }

        // Check if this is a restrict-template-expressions error
        if (line.includes('restrict-template-expressions') && currentFile) {
            // Format: "  127:34  error  Invalid type "number" of template literal expression"
            const match = line.match(/^\s*(\d+):(\d+)\s+error\s+Invalid type "([^"]+)" of template literal expression/);
            if (match) {
                const invalidType = match[3];
                if (shouldFixType(invalidType)) {
                    changes.push({
                        file: currentFile,
                        line: parseInt(match[1], 10),
                        col: parseInt(match[2], 10),
                        invalidType: invalidType,
                    });
                }
            }
        }
    }

    if (changes.length === 0) {
        console.log('No fixable restrict-template-expressions errors found in input.');
        console.log('Usage: bun run lint 2>&1 | bun run scripts/fix-template-expressions.ts [--dry-run|--apply]');
        process.exit(0);
    }

    console.log(`\n${isDryRun ? '🔍 DRY RUN MODE' : '✏️  APPLY MODE'}`);
    console.log(`Found ${changes.length} restrict-template-expressions errors to fix\n`);

    // Group changes by file
    const changesByFile = new Map<string, Change[]>();
    for (const change of changes) {
        const fileChanges = changesByFile.get(change.file) || [];
        fileChanges.push(change);
        changesByFile.set(change.file, fileChanges);
    }

    let totalFixed = 0;
    let totalSkipped = 0;
    let totalAlreadyWrapped = 0;

    for (const [filePath, fileChanges] of changesByFile) {
        // Sort by line descending, then col descending (to avoid offset issues when replacing)
        fileChanges.sort((a, b) => {
            if (b.line !== a.line) return b.line - a.line;
            return b.col - a.col;
        });

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        let modified = false;

        console.log(`\n📁 ${filePath}`);

        for (const change of fileChanges) {
            const lineIndex = change.line - 1; // 0-based
            const colIndex = change.col - 1;   // 0-based
            
            if (lineIndex >= lines.length) {
                console.log(`  ⚠️  Line ${change.line} out of range`);
                totalSkipped++;
                continue;
            }

            const line = lines[lineIndex];
            const bounds = findExpressionBounds(line, colIndex);
            
            if (!bounds) {
                console.log(`  ⚠️  Line ${change.line}:${change.col} - Could not find \${} expression`);
                console.log(`      ${line.substring(Math.max(0, colIndex - 20), Math.min(line.length, colIndex + 40))}`);
                totalSkipped++;
                continue;
            }
            
            if (isAlreadyWrapped(bounds.expr)) {
                console.log(`  ℹ️  Line ${change.line}:${change.col} - Already wrapped: \${${bounds.expr}}`);
                totalAlreadyWrapped++;
                continue;
            }
            
            // Create the new line with String() wrapper
            const newExpr = `String(${bounds.expr})`;
            const newLine = line.substring(0, bounds.start) + newExpr + line.substring(bounds.end);
            
            if (isDryRun) {
                console.log(`  Line ${change.line}:${change.col} [${change.invalidType}]`);
                console.log(`    - \${${bounds.expr}}`);
                console.log(`    + \${${newExpr}}`);
            }
            
            lines[lineIndex] = newLine;
            modified = true;
            totalFixed++;
        }

        if (modified && !isDryRun) {
            fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
            console.log(`  ✅ Saved changes`);
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Summary:`);
    console.log(`  Total errors found: ${changes.length}`);
    console.log(`  Fixes ${isDryRun ? 'would be applied' : 'applied'}: ${totalFixed}`);
    console.log(`  Already wrapped (skipped): ${totalAlreadyWrapped}`);
    console.log(`  Could not locate (skipped): ${totalSkipped}`);
    
    if (isDryRun) {
        console.log(`\n💡 To apply changes, run with --apply flag:`);
        console.log(`   bun run lint 2>&1 | bun run scripts/fix-template-expressions.ts --apply`);
    } else {
        console.log(`\n✅ Changes applied! Run lint again to verify.`);
    }
}

main().catch(console.error);
