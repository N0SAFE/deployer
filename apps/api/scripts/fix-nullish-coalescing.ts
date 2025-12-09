#!/usr/bin/env bun
/**
 * Script to replace || with ?? based on ESLint prefer-nullish-coalescing errors
 * 
 * Usage:
 *   bun run lint 2>&1 | bun run scripts/fix-nullish-coalescing.ts [--dry-run]
 *   
 * Options:
 *   --dry-run    Show what would be changed without modifying files (default)
 *   --apply      Actually apply the changes
 */

import * as fs from 'fs';
import * as readline from 'readline';

interface Change {
    file: string;
    line: number;
    col: number;
}

const isDryRun = !process.argv.includes('--apply');

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

        // Check if this is a nullish-coalescing error
        if (line.includes('prefer-nullish-coalescing') && currentFile) {
            // Format: "  266:49  error  Prefer using..."
            const match = line.match(/^\s*(\d+):(\d+)\s+error/);
            if (match) {
                changes.push({
                    file: currentFile,
                    line: parseInt(match[1], 10),
                    col: parseInt(match[2], 10),
                });
            }
        }
    }

    if (changes.length === 0) {
        console.log('No prefer-nullish-coalescing errors found in input.');
        console.log('Usage: bun run lint 2>&1 | bun run scripts/fix-nullish-coalescing.ts [--dry-run|--apply]');
        process.exit(0);
    }

    console.log(`\n${isDryRun ? '🔍 DRY RUN MODE' : '✏️  APPLY MODE'}`);
    console.log(`Found ${changes.length} prefer-nullish-coalescing errors\n`);

    // Group changes by file
    const changesByFile = new Map<string, Change[]>();
    for (const change of changes) {
        const fileChanges = changesByFile.get(change.file) || [];
        fileChanges.push(change);
        changesByFile.set(change.file, fileChanges);
    }

    let totalReplaced = 0;
    let totalSkipped = 0;

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
            const colIndex = change.col - 1; // 0-based
            
            if (lineIndex >= lines.length) {
                console.log(`  ⚠️  Line ${change.line} out of range (file has ${lines.length} lines)`);
                totalSkipped++;
                continue;
            }

            const line = lines[lineIndex];
            
            // Check if there's a || at or around the position
            // ESLint column points to the start of the expression, we need to find ||
            const beforeCol = line.substring(0, colIndex);
            const afterCol = line.substring(colIndex);
            
            // Find || in the vicinity (could be at col or slightly after)
            const orIndex = afterCol.indexOf('||');
            
            if (orIndex === -1 || orIndex > 50) {
                // Try looking backwards from col
                const beforeOrIndex = beforeCol.lastIndexOf('||');
                if (beforeOrIndex !== -1 && (beforeCol.length - beforeOrIndex) < 20) {
                    // Found || before the column
                    const newLine = beforeCol.substring(0, beforeOrIndex) + '??' + beforeCol.substring(beforeOrIndex + 2) + afterCol;
                    
                    if (isDryRun) {
                        console.log(`  Line ${change.line}:${change.col}`);
                        console.log(`    - ${line.trim()}`);
                        console.log(`    + ${newLine.trim()}`);
                    }
                    
                    lines[lineIndex] = newLine;
                    modified = true;
                    totalReplaced++;
                } else {
                    console.log(`  ⚠️  Line ${change.line}:${change.col} - Could not find || near position`);
                    console.log(`      ${line.substring(Math.max(0, colIndex - 20), colIndex + 30)}`);
                    totalSkipped++;
                }
            } else {
                // Found || after the column position
                const actualOrPos = colIndex + orIndex;
                const newLine = line.substring(0, actualOrPos) + '??' + line.substring(actualOrPos + 2);
                
                if (isDryRun) {
                    console.log(`  Line ${change.line}:${change.col}`);
                    console.log(`    - ${line.trim()}`);
                    console.log(`    + ${newLine.trim()}`);
                }
                
                lines[lineIndex] = newLine;
                modified = true;
                totalReplaced++;
            }
        }

        if (modified && !isDryRun) {
            fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
            console.log(`  ✅ Saved ${fileChanges.length} changes`);
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Summary:`);
    console.log(`  Total errors found: ${changes.length}`);
    console.log(`  Replacements ${isDryRun ? 'would be made' : 'made'}: ${totalReplaced}`);
    console.log(`  Skipped (could not locate ||): ${totalSkipped}`);
    
    if (isDryRun) {
        console.log(`\n💡 To apply changes, run with --apply flag:`);
        console.log(`   bun run lint 2>&1 | bun run scripts/fix-nullish-coalescing.ts --apply`);
    } else {
        console.log(`\n✅ Changes applied! Run type-check to verify.`);
    }
}

main().catch(console.error);
