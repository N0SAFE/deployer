#!/usr/bin/env bun
/**
 * Fix @typescript-eslint/no-unused-vars errors
 *
 * This script prefixes unused variables with underscore (_) to indicate they are intentionally unused.
 * This is safer than removing them as it preserves the code structure.
 *
 * Usage:
 *   Dry run (preview changes):
 *     bun run lint 2>&1 | bun run scripts/fix-unused-vars.ts --dry-run
 *
 *   Apply changes:
 *     bun run lint 2>&1 | bun run scripts/fix-unused-vars.ts --apply
 */

import * as readline from 'readline';
import * as fs from 'fs';

interface ErrorInfo {
    file: string;
    line: number;
    col: number;
    message: string;
    varName: string;
}

const RULE = '@typescript-eslint/no-unused-vars';

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

function extractVarName(message: string): string | null {
    // "'varName' is defined but never used"
    // "'varName' is declared but its value is never read"
    const match = message.match(/^'([^']+)'/);
    return match ? match[1] : null;
}

interface Fix {
    file: string;
    line: number;
    col: number;
    oldText: string;
    newText: string;
    varName: string;
}

function findVarToFix(content: string, lineNum: number, col: number, varName: string): Fix | null {
    const lines = content.split('\n');
    const lineIndex = lineNum - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
        return null;
    }

    const line = lines[lineIndex];

    // Skip if already prefixed with underscore
    if (varName.startsWith('_')) {
        return null;
    }

    // Find the variable name in the line at or near the column
    // Account for various contexts: const x, let x, function(x), { x }, [x], etc.

    // Build a regex that finds the exact variable name as a word boundary
    const varRegex = new RegExp(`\\b${escapeRegex(varName)}\\b`);
    const match = line.match(varRegex);

    if (!match || match.index === undefined) {
        return null;
    }

    // Check if this is an import statement - we might want to skip those
    // as removing imports is cleaner than prefixing
    if (line.includes('import ') && line.includes(' from ')) {
        return null; // Skip imports, they should be removed instead
    }

    const oldText = line;
    const newText =
        line.slice(0, match.index) +
        '_' + varName +
        line.slice(match.index + varName.length);

    return {
        file: '',
        line: lineNum,
        col: match.index + 1,
        oldText,
        newText,
        varName,
    };
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const apply = args.includes('--apply');

    if (!dryRun && !apply) {
        console.log(c('yellow', 'Usage:'));
        console.log('  bun run lint 2>&1 | bun run scripts/fix-unused-vars.ts --dry-run');
        console.log('  bun run lint 2>&1 | bun run scripts/fix-unused-vars.ts --apply');
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
            const varName = extractVarName(errorMatch[4].trim());
            if (varName) {
                errors.push({
                    file: currentFile,
                    line: parseInt(errorMatch[1], 10),
                    col: parseInt(errorMatch[2], 10),
                    message: errorMatch[4].trim(),
                    varName,
                });
            }
        }
    }

    if (errors.length === 0) {
        console.log(c('green', `✓ No ${RULE} errors found!`));
        process.exit(0);
    }

    console.log(c('bold', `\nFound ${errors.length} ${RULE} errors\n`));

    // Group by file
    const errorsByFile = new Map<string, ErrorInfo[]>();
    for (const error of errors) {
        if (!errorsByFile.has(error.file)) {
            errorsByFile.set(error.file, []);
        }
        errorsByFile.get(error.file)!.push(error);
    }

    const fixes: Fix[] = [];
    const skipped: Array<{ file: string; line: number; reason: string }> = [];

    // Process each file
    for (const [file, fileErrors] of errorsByFile) {
        let content: string;
        try {
            content = fs.readFileSync(file, 'utf-8');
        } catch {
            skipped.push({ file, line: 0, reason: 'Could not read file' });
            continue;
        }

        for (const error of fileErrors) {
            const fix = findVarToFix(content, error.line, error.col, error.varName);

            if (fix) {
                fix.file = file;
                fixes.push(fix);
            } else {
                skipped.push({
                    file,
                    line: error.line,
                    reason: `Could not find '${error.varName}' or it's an import`,
                });
            }
        }
    }

    // Display fixes
    console.log(c('bold', '─'.repeat(80)));
    console.log(c('bold', dryRun ? 'PREVIEW (dry run)' : 'APPLYING FIXES'));
    console.log(c('bold', '─'.repeat(80)));

    for (const fix of fixes) {
        const relativePath = getRelativePath(fix.file);
        console.log(`\n${c('blue', relativePath)}:${c('yellow', String(fix.line))} (${fix.varName} → _${fix.varName})`);
        console.log(`  ${c('red', '- ' + fix.oldText.trim())}`);
        console.log(`  ${c('green', '+ ' + fix.newText.trim())}`);
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
        for (const [file, fileFixes] of fixesByFile) {
            let content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');

            // Sort by line descending to apply from bottom to top
            fileFixes.sort((a, b) => b.line - a.line);

            for (const fix of fileFixes) {
                const lineIndex = fix.line - 1;
                if (lines[lineIndex] === fix.oldText) {
                    lines[lineIndex] = fix.newText;
                    appliedCount++;
                }
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
    console.log(`  Fixable:        ${c('green', String(fixes.length))}`);
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
