// ============================================================================
// KARP Inspector Lite — Codebase Searcher (Node.js)
// Version: 1.0.0
// Author: SoulDriver (Adelaide, Australia)
// Description: Semantic search, grep, file outline, diff, and version tracking.
//              Works with the in-memory vector store from indexer.js.
// License: MIT
// ============================================================================

const fs = require('fs');
const path = require('path');

const indexer = require('./indexer');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let projectRoot = '';

function configure(root) {
    projectRoot = root;
    log('INFO', `Searcher configured: ${projectRoot}`);
}

// ---------------------------------------------------------------------------
// search_code — Semantic Vector Search
// ---------------------------------------------------------------------------

async function searchCode(query, limit = 8, fileFilter = null, extFilter = null) {
    if (!indexer.vectorStore.isIndexed) {
        return { error: 'Project not indexed yet. Run index_project first.' };
    }

    const queryEmbedding = await indexer.generateEmbedding(query);

    const filterFn = (payload) => {
        if (fileFilter && !payload.filepath.includes(fileFilter)) return false;
        if (extFilter && !payload.filepath.endsWith(extFilter)) return false;
        return true;
    };

    const results = indexer.vectorSearch(queryEmbedding, limit, filterFn);

    return {
        query,
        results: results.map(r => ({
            file: r.payload.filepath,
            name: r.payload.name,
            chunk_type: r.payload.chunk_type,
            line_start: r.payload.line_start,
            line_end: r.payload.line_end,
            text: r.payload.text.substring(0, 500),
            score: Math.round(r.score * 10000) / 10000
        })),
        total: results.length
    };
}

// ---------------------------------------------------------------------------
// grep_code — Exact String / Regex Search
// ---------------------------------------------------------------------------

async function grepCode(pattern, isRegex = false, caseSensitive = true, limit = 50, contextLines = 2, fileFilter = null, extFilter = null) {
    if (!projectRoot) return { error: 'Project root not configured' };

    let regex;
    try {
        const flags = caseSensitive ? '' : 'i';
        regex = isRegex ? new RegExp(pattern, flags) : new RegExp(escapeRegex(pattern), flags);
    } catch (e) {
        return { error: `Invalid regex: ${e.message}` };
    }

    const matches = [];
    const files = indexer.discoverFiles(
        projectRoot,
        indexer.DEFAULTS.includeExtensions,
        indexer.DEFAULTS.skipDirs,
        indexer.DEFAULTS.maxFileSize
    );

    for (const filepath of files) {
        const filename = path.basename(filepath);
        const ext = path.extname(filepath).toLowerCase();
        const relPath = path.relative(projectRoot, filepath);

        if (fileFilter && !filename.includes(fileFilter)) continue;
        if (extFilter && ext !== extFilter) continue;

        let lines;
        try {
            lines = fs.readFileSync(filepath, 'utf-8').split('\n');
        } catch (e) {
            continue;
        }

        for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
                const start = Math.max(0, i - contextLines);
                const end = Math.min(lines.length, i + contextLines + 1);
                const context = lines.slice(start, end).join('\n');

                matches.push({
                    file: relPath,
                    line_number: i + 1,
                    match: lines[i].trim(),
                    context
                });

                if (matches.length >= limit) {
                    return { pattern, matches, total: matches.length, truncated: true };
                }
            }
        }
    }

    return { pattern, matches, total: matches.length, truncated: false };
}

// ---------------------------------------------------------------------------
// file_outline — Structural Overview
// ---------------------------------------------------------------------------

async function fileOutline(filepath, includeBody = false) {
    if (!projectRoot) return { error: 'Project root not configured' };

    const fullPath = path.join(projectRoot, filepath);
    if (!fs.existsSync(fullPath)) return { error: `File not found: ${filepath}` };

    let source;
    try {
        source = fs.readFileSync(fullPath, 'utf-8');
    } catch (e) {
        return { error: `Cannot read file: ${e.message}` };
    }

    const lines = source.split('\n');
    const ext = path.extname(filepath).toLowerCase();
    const outline = [];

    // --- Python: regex-based outline (handles multi-line signatures) ---
    if (ext === '.py') {
        const classRegex = /^(\s*)class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/;
        const funcStartRegex = /^(\s*)(async\s+)?def\s+(\w+)\s*\(/;

        for (let i = 0; i < lines.length; i++) {
            const classMatch = lines[i].match(classRegex);
            const funcStartMatch = lines[i].match(funcStartRegex);

            if (classMatch) {
                const entry = {
                    type: 'class',
                    name: classMatch[2],
                    line_start: i + 1,
                    bases: classMatch[3] || ''
                };
                // Look for docstring on next non-empty line after class:
                for (let d = i + 1; d < Math.min(i + 5, lines.length); d++) {
                    const trimmed = lines[d].trim();
                    if (trimmed.startsWith('"""')) {
                        entry.docstring = trimmed.replace(/"""/g, '').trim().substring(0, 150);
                        break;
                    }
                    if (trimmed && !trimmed.startsWith('#')) break;
                }
                if (includeBody) {
                    entry.body_preview = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
                }
                outline.push(entry);
            }

            if (funcStartMatch) {
                const indent = funcStartMatch[1].length;
                const isMethod = indent > 0;
                const asyncPrefix = funcStartMatch[2] || '';
                const funcName = funcStartMatch[3];

                // Build full signature — handle multi-line params
                let sigLines = [lines[i]];
                let sigEnd = i;
                if (!lines[i].includes('):') && !lines[i].match(/\)\s*(->[^:]*)?:\s*$/)) {
                    // Opening paren without closing — scan forward
                    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                        sigLines.push(lines[j]);
                        sigEnd = j;
                        if (lines[j].includes('):') || lines[j].match(/\)\s*(->[^:]*)?:\s*$/)) break;
                    }
                }
                const fullSig = sigLines.map(l => l.trim()).join(' ').replace(/\s+/g, ' ');

                const entry = {
                    type: isMethod ? 'method' : 'function',
                    name: funcName,
                    line_start: i + 1,
                    signature: fullSig.replace(/:\s*$/, '')
                };
                // Look for docstring after signature
                for (let d = sigEnd + 1; d < Math.min(sigEnd + 5, lines.length); d++) {
                    const trimmed = lines[d].trim();
                    if (trimmed.startsWith('"""')) {
                        entry.docstring = trimmed.replace(/"""/g, '').trim().substring(0, 150);
                        break;
                    }
                    if (trimmed && !trimmed.startsWith('#')) break;
                }
                if (includeBody) {
                    entry.body_preview = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
                }
                outline.push(entry);
            }
        }
    }

    // --- JavaScript/TypeScript: Acorn AST ---
    else if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
        try {
            const acorn = require('acorn');
            const walk = require('acorn-walk');

            const ast = acorn.parse(source, {
                ecmaVersion: 'latest',
                sourceType: 'module',
                locations: true,
                allowImportExportEverywhere: true,
                allowReturnOutsideFunction: true
            });

            walk.simple(ast, {
                FunctionDeclaration(node) {
                    const entry = {
                        type: 'function',
                        name: node.id ? node.id.name : '(anonymous)',
                        line_start: node.loc.start.line,
                        line_end: node.loc.end.line
                    };
                    if (includeBody) {
                        entry.body_preview = lines.slice(node.loc.start.line - 1, node.loc.start.line + 4).join('\n');
                    }
                    outline.push(entry);
                },
                ClassDeclaration(node) {
                    const entry = {
                        type: 'class',
                        name: node.id ? node.id.name : '(anonymous)',
                        line_start: node.loc.start.line,
                        line_end: node.loc.end.line
                    };
                    outline.push(entry);
                },
                VariableDeclaration(node) {
                    for (const decl of node.declarations) {
                        if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
                            outline.push({
                                type: 'function',
                                name: decl.id ? decl.id.name : '(anonymous)',
                                line_start: node.loc.start.line,
                                line_end: node.loc.end.line
                            });
                        }
                    }
                }
            });
        } catch (e) {
            outline.push({ type: 'error', message: `Parse failed: ${e.message}` });
        }
    }

    // --- HTML: extract <script> blocks and parse with Acorn ---
    else if (['.html', '.htm'].includes(ext)) {
        // Find all <script> blocks and extract JS functions
        let inScript = false;
        let scriptStart = 0;
        let scriptLines = [];

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('<script') && !lines[i].includes('src=')) {
                inScript = true;
                scriptStart = i + 1;
                scriptLines = [];
                continue;
            }
            if (inScript && lines[i].includes('</script>')) {
                inScript = false;

                // Parse the collected script block with Acorn
                const scriptSource = scriptLines.join('\n');
                try {
                    const acorn = require('acorn');
                    const walk = require('acorn-walk');
                    const ast = acorn.parse(scriptSource, {
                        ecmaVersion: 'latest',
                        sourceType: 'module',
                        locations: true,
                        allowImportExportEverywhere: true,
                        allowReturnOutsideFunction: true
                    });
                    walk.simple(ast, {
                        FunctionDeclaration(node) {
                            outline.push({
                                type: 'function',
                                name: node.id ? node.id.name : '(anonymous)',
                                line_start: scriptStart + node.loc.start.line,
                                line_end: scriptStart + node.loc.end.line
                            });
                        },
                        VariableDeclaration(node) {
                            for (const decl of node.declarations) {
                                if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
                                    outline.push({
                                        type: 'function',
                                        name: decl.id ? decl.id.name : '(anonymous)',
                                        line_start: scriptStart + node.loc.start.line,
                                        line_end: scriptStart + node.loc.end.line
                                    });
                                }
                            }
                        }
                    });
                } catch (e) {
                    // Acorn failed on this script block — use regex fallback
                    const funcRegex = /^\s*(?:async\s+)?function\s+(\w+)/;
                    const arrowRegex = /^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/;
                    for (let s = 0; s < scriptLines.length; s++) {
                        const funcMatch = scriptLines[s].match(funcRegex);
                        const arrowMatch = scriptLines[s].match(arrowRegex);
                        if (funcMatch) {
                            outline.push({ type: 'function', name: funcMatch[1], line_start: scriptStart + s + 1 });
                        } else if (arrowMatch) {
                            outline.push({ type: 'function', name: arrowMatch[1], line_start: scriptStart + s + 1 });
                        }
                    }
                }
                continue;
            }
            if (inScript) {
                scriptLines.push(lines[i]);
            }
        }

        if (outline.length === 0) {
            outline.push({ type: 'file_info', name: path.basename(filepath), total_lines: lines.length, extension: ext });
        }
    }

    // --- Other files: basic info ---
    else {
        outline.push({
            type: 'file_info',
            name: path.basename(filepath),
            total_lines: lines.length,
            extension: ext
        });
    }

    return {
        file: filepath,
        total_lines: lines.length,
        outline
    };
}

// ---------------------------------------------------------------------------
// file_history — Snapshot Listing
// ---------------------------------------------------------------------------

async function fileHistory(filepath) {
    if (!projectRoot) return { error: 'Project root not configured' };

    const snapshotDir = path.join(projectRoot, '.karp-inspector', 'snapshots', filepath);
    const snapshots = [];

    if (fs.existsSync(snapshotDir)) {
        const entries = fs.readdirSync(snapshotDir)
            .filter(f => f.endsWith('.snapshot'))
            .sort()
            .reverse();

        for (const entry of entries) {
            const fullPath = path.join(snapshotDir, entry);
            const stat = fs.statSync(fullPath);
            snapshots.push({
                filename: entry,
                timestamp: stat.mtime.toISOString(),
                size_bytes: stat.size,
                path: path.relative(projectRoot, fullPath)
            });
        }
    }

    return { file: filepath, snapshots, total: snapshots.length };
}

// ---------------------------------------------------------------------------
// file_diff — Compare Snapshots
// ---------------------------------------------------------------------------

async function fileDiff(filepath, oldIndex = 1, newIndex = 0) {
    if (!projectRoot) return { error: 'Project root not configured' };

    const snapshotDir = path.join(projectRoot, '.karp-inspector', 'snapshots', filepath);
    if (!fs.existsSync(snapshotDir)) return { error: `No snapshots for ${filepath}` };

    const snapshots = fs.readdirSync(snapshotDir)
        .filter(f => f.endsWith('.snapshot'))
        .sort()
        .reverse();

    if (snapshots.length === 0) return { error: `No snapshots for ${filepath}` };

    // Get old content
    if (oldIndex >= snapshots.length) return { error: `Snapshot ${oldIndex} out of range` };
    const oldContent = fs.readFileSync(path.join(snapshotDir, snapshots[oldIndex]), 'utf-8').split('\n');

    // Get new content
    let newContent, newLabel;
    if (newIndex === -1) {
        const livePath = path.join(projectRoot, filepath);
        if (!fs.existsSync(livePath)) return { error: `Live file not found: ${filepath}` };
        newContent = fs.readFileSync(livePath, 'utf-8').split('\n');
        newLabel = `${filepath} (live)`;
    } else {
        if (newIndex >= snapshots.length) return { error: `Snapshot ${newIndex} out of range` };
        newContent = fs.readFileSync(path.join(snapshotDir, snapshots[newIndex]), 'utf-8').split('\n');
        newLabel = snapshots[newIndex];
    }

    // Simple unified diff
    const diffLines = simpleDiff(oldContent, newContent, snapshots[oldIndex], newLabel);
    const additions = diffLines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
    const deletions = diffLines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

    return {
        file: filepath,
        additions,
        deletions,
        diff_text: diffLines.join('\n') || '(no changes)'
    };
}

// Simple line-by-line diff (no external dependency)
function simpleDiff(oldLines, newLines, oldLabel, newLabel) {
    const result = [`--- ${oldLabel}`, `+++ ${newLabel}`];
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;

        if (oldLine === newLine) continue;
        if (oldLine !== undefined && newLine !== undefined && oldLine !== newLine) {
            result.push(`-${oldLine}`);
            result.push(`+${newLine}`);
        } else if (oldLine === undefined) {
            result.push(`+${newLine}`);
        } else {
            result.push(`-${oldLine}`);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// project_stats — Index Statistics
// ---------------------------------------------------------------------------

async function projectStats() {
    const byType = {};
    const byExt = {};

    for (const v of indexer.vectorStore.vectors) {
        const type = v.payload.chunk_type || 'unknown';
        const ext = path.extname(v.payload.filepath).toLowerCase() || 'unknown';
        byType[type] = (byType[type] || 0) + 1;
        byExt[ext] = (byExt[ext] || 0) + 1;
    }

    return {
        total_chunks: indexer.vectorStore.vectors.length,
        is_indexed: indexer.vectorStore.isIndexed,
        files_tracked: Object.keys(indexer.vectorStore.hashMap).length,
        by_chunk_type: byType,
        by_extension: byExt,
        project_root: projectRoot || '(not configured)',
        powered_by: 'KARP Inspector Lite by SoulDriver — souldriver.com.au'
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    configure,
    searchCode,
    grepCode,
    fileOutline,
    fileHistory,
    fileDiff,
    projectStats
};
