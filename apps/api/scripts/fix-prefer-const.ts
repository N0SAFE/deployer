#!/usr/bin/env bun
/**
 * Fix prefer-const errors
 *
 * This script changes `let` to `const` for variables that are never reassigned.
 *
 * Usage:
 *   Dry run (preview changes):
 *     bun run lint 2>&1 | bun run scripts/fix-prefer-const.ts --dry-run
 *
 *   Apply changes:
 *     bun run lint 2>&1 | bun run scripts/fix-prefer-const.ts --apply
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

const RULE = 'prefer-const';

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
    // "'varName' is never reassigned. Use 'const' instead."
    const match = message.match(/^'([^']+)'/);
    return match ? match[1] : null;
}

interface Fix {
    file: string;
    line: number;
    oldText: string;
    newText: string;
    varName: string;
}

function findLetToFix(content: string, lineNum: number, varName: string): Fix | null {
    const lines = content.split('\n');
    const lineIndex = lineNum - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
        return null;
    }

    const line = lines[lineIndex];

    // Find 'let' keyword followed by the variable name
    // Patterns: let x, let { x }, let [x]
    const letRegex = /\blet\s+/;
    const match = line.match(letRegex);

    if (!match || match.index === undefined) {
        return null;
    }

    // Verify this let declaration includes our variable
    const afterLet = line.slice(match.index + match[0].length);
    const varRegex = new RegExp(`\\b${escapeRegex(varName)}\\b`);
    
    if (!varRegex.test(afterLet)) {
        return null;
    }

    const oldText = line;
    const newText = line.slice(0, match.index) + 'const ' + line.slice(match.index + match[0].length);

    return {
        file: '',
        line: lineNum,
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
        console.log('  bun run lint 2>&1 | bun run scripts/fix-prefer-const.ts --dry-run');
        console.log('  bun run lint 2>&1 | bun run scripts/fix-prefer-const.ts --apply');
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

    // Deduplicate by file:line (multiple vars on same let line)
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
    for (const error of uniqueErrors.values()) {
        let content: string;
        try {
            content = fs.readFileSync(error.file, 'utf-8');
        } catch {
            skipped.push({ file: error.file, line: 0, reason: 'Could not read file' });
            continue;
        }

        const fix = findLetToFix(content, error.line, error.varName);

        if (fix) {
            fix.file = error.file;
            fixes.push(fix);
        } else {
            skipped.push({
                file: error.file,
                line: error.line,
                reason: `Could not find 'let' for '${error.varName}'`,
            });
        }
    }

    // Display fixes
    console.log(c('bold', '─'.repeat(80)));
    console.log(c('bold', dryRun ? 'PREVIEW (dry run)' : 'APPLYING FIXES'));
    console.log(c('bold', '─'.repeat(80)));

    for (const fix of fixes) {
        const relativePath = getRelativePath(fix.file);
        console.log(`\n${c('blue', relativePath)}:${c('yellow', String(fix.line))} (let → const)`);
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
        for (const [file, fileFixes] of Array.from(fixesByFile.entries())) {
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
