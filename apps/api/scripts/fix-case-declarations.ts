#!/usr/bin/env bun
/**
 * Fix no-case-declarations errors
 *
 * This script wraps case block contents in curly braces {} to create a proper lexical scope.
 *
 * Usage:
 *   Dry run (preview changes):
 *     bun run lint 2>&1 | bun run scripts/fix-case-declarations.ts --dry-run
 *
 *   Apply changes:
 *     bun run lint 2>&1 | bun run scripts/fix-case-declarations.ts --apply
 */

import * as readline from 'readline';
import * as fs from 'fs';

interface ErrorInfo {
    file: string;
    line: number;
    col: number;
    message: string;
}

const RULE = 'no-case-declarations';

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

function getRelativePath(filePath: string): string {
    const cwd = process.cwd();
    if (filePath.startsWith(cwd)) {
        return filePath.slice(cwd.length + 1);
    }
    return filePath;
}

interface Fix {
    file: string;
    caseStartLine: number;
    caseEndLine: number;
    oldLines: string[];
    newLines: string[];
}

function findCaseBlockToFix(content: string, errorLine: number): Fix | null {
    const lines = content.split('\n');
    const errorIndex = errorLine - 1;

    if (errorIndex < 0 || errorIndex >= lines.length) {
        return null;
    }

    // Find the start of the case block (case xxx: or default:)
    let caseStartLine = -1;
    for (let i = errorIndex; i >= 0; i--) {
        const line = lines[i];
        if (/^\s*(case\s+.+:|default:)\s*$/.test(line) || /^\s*(case\s+.+:|default:)\s*{/.test(line)) {
            // Already has opening brace
            if (line.includes('{')) {
                return null;
            }
            caseStartLine = i;
            break;
        }
    }

    if (caseStartLine === -1) {
        return null;
    }

    // Find the end of the case block (next case/default/closing brace of switch)
    let caseEndLine = -1;
    let braceDepth = 0;

    for (let i = caseStartLine + 1; i < lines.length; i++) {
        const line = lines[i];

        // Track brace depth for nested blocks
        for (const char of line) {
            if (char === '{') braceDepth++;
            else if (char === '}') braceDepth--;
        }

        // Found next case/default or end of switch (at same brace level)
        if (braceDepth <= 0) {
            if (/^\s*(case\s+.+:|default:)/.test(line)) {
                caseEndLine = i - 1;
                break;
            }
            if (/^\s*}/.test(line) && braceDepth < 0) {
                caseEndLine = i - 1;
                break;
            }
        }
    }

    if (caseEndLine === -1 || caseEndLine <= caseStartLine) {
        return null;
    }

    // Build the old and new lines
    const oldLines = lines.slice(caseStartLine, caseEndLine + 1);
    const caseLine = oldLines[0];
    const indent = caseLine.match(/^(\s*)/)?.[1] || '';

    // Check if already wrapped
    if (oldLines.length > 1 && oldLines[1].trim() === '{') {
        return null;
    }

    const newLines: string[] = [];
    newLines.push(caseLine + ' {');

    // Add body lines (they should already be indented properly)
    for (let i = 1; i < oldLines.length; i++) {
        newLines.push(oldLines[i]);
    }

    // Add closing brace after the break/return (at the end of the case block)
    const lastLine = oldLines[oldLines.length - 1];
    if (/^\s*(break|return)/.test(lastLine)) {
        // Add closing brace after the break/return
        newLines.push(indent + '}');
    } else {
        // Add closing brace at the end
        newLines.push(indent + '}');
    }

    return {
        file: '',
        caseStartLine: caseStartLine + 1,
        caseEndLine: caseEndLine + 1,
        oldLines,
        newLines,
    };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const apply = args.includes('--apply');

    if (!dryRun && !apply) {
        console.log(c('yellow', 'Usage:'));
        console.log('  bun run lint 2>&1 | bun run scripts/fix-case-declarations.ts --dry-run');
        console.log('  bun run lint 2>&1 | bun run scripts/fix-case-declarations.ts --apply');
        process.exit(1);
    }

    const errors: ErrorInfo[] = [];
    let currentFile = '';

    const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
    });

    // Parse ESLint output
    for await (const line of rl) {
        const fileMatch = line.match(/^(\/[^\s]+\.tsx?)$/);
        if (fileMatch) {
            currentFile = fileMatch[1];
            continue;
        }

        const errorMatch = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/);
        if (errorMatch && currentFile && errorMatch[5] === RULE) {
            errors.push({
                file: currentFile,
                line: parseInt(errorMatch[1], 10),
                col: parseInt(errorMatch[2], 10),
                message: errorMatch[4].trim(),
            });
        }
    }

    if (errors.length === 0) {
        console.log(c('green', `✓ No ${RULE} errors found!`));
        process.exit(0);
    }

    console.log(c('bold', `\nFound ${errors.length} ${RULE} errors\n`));

    // Deduplicate errors by file and case block
    const uniqueErrors = new Map<string, ErrorInfo>();
    for (const error of errors) {
        const key = `${error.file}:${error.line}`;
        if (!uniqueErrors.has(key)) {
            uniqueErrors.set(key, error);
        }
    }

    const fixes: Fix[] = [];
    const skipped: Array<{ file: string; line: number; reason: string }> = [];

    // Process each unique error
    const processedCases = new Set<string>();

    for (const error of uniqueErrors.values()) {
        let content: string;
        try {
            content = fs.readFileSync(error.file, 'utf-8');
        } catch {
            skipped.push({ file: error.file, line: 0, reason: 'Could not read file' });
            continue;
        }

        const fix = findCaseBlockToFix(content, error.line);

        if (fix) {
            const caseKey = `${error.file}:${fix.caseStartLine}`;
            if (!processedCases.has(caseKey)) {
                processedCases.add(caseKey);
                fix.file = error.file;
                fixes.push(fix);
            }
        } else {
            skipped.push({
                file: error.file,
                line: error.line,
                reason: 'Could not find case block or already wrapped',
            });
        }
    }

    // Display fixes
    console.log(c('bold', '─'.repeat(80)));
    console.log(c('bold', dryRun ? 'PREVIEW (dry run)' : 'APPLYING FIXES'));
    console.log(c('bold', '─'.repeat(80)));

    for (const fix of fixes) {
        const relativePath = getRelativePath(fix.file);
        console.log(`\n${c('blue', relativePath)}:${c('yellow', String(fix.caseStartLine))}-${fix.caseEndLine}`);
        console.log(c('red', '  Old:'));
        for (const line of fix.oldLines) {
            console.log(`    ${c('dim', line)}`);
        }
        console.log(c('green', '  New:'));
        for (const line of fix.newLines) {
            console.log(`    ${line}`);
        }
    }

    // Apply fixes if requested
    if (apply && fixes.length > 0) {
        // Group fixes by file
        const fixesByFile = new Map<string, Fix[]>();
        for (const fix of fixes) {
            if (!fixesByFile.has(fix.file)) {
                fixesByFile.set(fix.file, []);
            }
            fixesByFile.get(fix.file)!.push(fix);
        }

        let appliedCount = 0;
        for (const [file, fileFixes] of Array.from(fixesByFile.entries())) {
            let content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');

            // Sort by line descending to apply from bottom to top
            fileFixes.sort((a, b) => b.caseStartLine - a.caseStartLine);

            for (const fix of fileFixes) {
                const startIdx = fix.caseStartLine - 1;
                const endIdx = fix.caseEndLine - 1;

                // Replace the old lines with new lines
                lines.splice(startIdx, endIdx - startIdx + 1, ...fix.newLines);
                appliedCount++;
            }

            fs.writeFileSync(file, lines.join('\n'));
        }

        console.log(c('green', `\n✓ Applied ${appliedCount} fixes`));
    }

    // Summary
    console.log(c('bold', '\n' + '─'.repeat(80)));
    console.log(c('bold', 'SUMMARY'));
    console.log(c('bold', '─'.repeat(80)));
    console.log(`  Total errors:   ${errors.length}`);
    console.log(`  Case blocks:    ${fixes.length}`);
    console.log(`  Skipped:        ${c('yellow', String(skipped.length))}`);

    if (skipped.length > 0) {
        console.log(c('yellow', '\nSkipped (need manual review):'));
        for (const skip of skipped.slice(0, 10)) {
            const relativePath = getRelativePath(skip.file);
            console.log(`  ${relativePath}:${skip.line} - ${skip.reason}`);
        }
        if (skipped.length > 10) {
            console.log(`  ... and ${skipped.length - 10} more`);
        }
    }

    if (dryRun) {
        console.log(c('cyan', '\nRun with --apply to apply these fixes'));
    }
}

main().catch(console.error);
