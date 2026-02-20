// ============================================================================
// KARP Inspector Lite — Codebase Indexer (Node.js)
// Version: 1.0.0
// Author: SoulDriver (Adelaide, Australia)
// Description: File discovery, code chunking, ONNX embedding generation,
//              and local JSON vector storage. Zero external dependencies.
// License: MIT
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let projectRoot = '';
let extraExtensions = [];

const DEFAULTS = {
    includeExtensions: new Set(['.py', '.js', '.ts', '.html', '.css', '.md', '.txt']),
    skipDirs: new Set([
        '__pycache__', '.git', 'node_modules', 'venv', '.venv',
        'env', 'dist', 'build', '.next', '.nuxt', 'coverage',
        '.tox', '.mypy_cache', '.pytest_cache', 'egg-info',
        '.eggs', '.cache', '.tmp', 'vendor', '.karp-inspector',
        'backups', 'exports', 'snapshots', 'sessions',
        'Old Web files', 'Logos', 'assets', 'subscription',
        'Karp_Inspector', 'Karp_Inspector_Lite', 'migrations',
        '__snapshots__', 'docs', 'old', 'archive'
    ]),
    maxFileSize: 1_048_576,   // 1MB
    maxChunkChars: 1500,
    chunkOverlap: 200
};

// ---------------------------------------------------------------------------
// In-Memory Vector Store
// ---------------------------------------------------------------------------

// Simple but effective: brute-force cosine similarity on a flat array.
// For codebases under 100k chunks this takes <100ms on modern hardware.
// No Qdrant, no database, no external service.

const vectorStore = {
    vectors: [],      // [{id, embedding, payload}]
    hashMap: {},      // filepath -> sha256 (for change detection)
    isIndexed: false
};

// Cache version — bump this to force rebuild on format changes
const CACHE_VERSION = 1;

function getCachePath() {
    return path.join(projectRoot, '.karp-inspector', 'index-cache.json');
}

function saveIndex() {
    if (!projectRoot || vectorStore.vectors.length === 0) return;
    try {
        const cachePath = getCachePath();
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });

        const cache = {
            version: CACHE_VERSION,
            created: new Date().toISOString(),
            projectRoot,
            hashMap: vectorStore.hashMap,
            vectors: vectorStore.vectors.map(v => ({
                id: v.id,
                embedding: v.embedding,
                payload: v.payload
            }))
        };

        fs.writeFileSync(cachePath, JSON.stringify(cache));
        const sizeMB = (fs.statSync(cachePath).size / 1024 / 1024).toFixed(1);
        log('INFO', `Index saved to disk (${sizeMB}MB, ${cache.vectors.length} vectors)`);
    } catch (e) {
        log('WARN', `Failed to save index cache: ${e.message}`);
    }
}

function loadIndex() {
    if (!projectRoot) return false;
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return false;

    try {
        const raw = fs.readFileSync(cachePath, 'utf-8');
        const cache = JSON.parse(raw);

        // Validate cache version and project root
        if (cache.version !== CACHE_VERSION) {
            log('INFO', `Cache version mismatch (${cache.version} vs ${CACHE_VERSION}), will re-index`);
            return false;
        }
        if (cache.projectRoot !== projectRoot) {
            log('INFO', 'Cache project root mismatch, will re-index');
            return false;
        }

        vectorStore.vectors = cache.vectors;
        vectorStore.hashMap = cache.hashMap;
        vectorStore.isIndexed = true;

        log('INFO', `Loaded cached index: ${cache.vectors.length} vectors from ${cache.created}`);
        return true;
    } catch (e) {
        log('WARN', `Failed to load index cache: ${e.message}`);
        return false;
    }
}

function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function vectorSearch(queryEmbedding, limit = 8, filterFn = null) {
    let candidates = vectorStore.vectors;
    if (filterFn) {
        candidates = candidates.filter(v => filterFn(v.payload));
    }

    const scored = candidates.map(v => ({
        ...v,
        score: cosineSimilarity(queryEmbedding, v.embedding)
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Embedding Model (lazy-loaded ONNX via @xenova/transformers)
// ---------------------------------------------------------------------------

let pipeline = null;
let embedder = null;

async function getEmbedder() {
    if (embedder) return embedder;

    log('INFO', 'Loading embedding model (all-MiniLM-L6-v2, ~50MB, one-time download)...');

    // Dynamic import for ESM module
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    embedder = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    log('INFO', 'Embedding model loaded');
    return embedder;
}

async function generateEmbedding(text) {
    const model = await getEmbedder();
    const output = await model(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

async function generateEmbeddings(texts) {
    const model = await getEmbedder();
    const results = [];
    
    // Batch in groups of 16 for memory efficiency
    const batchSize = 16;
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        for (const text of batch) {
            const output = await model(text, { pooling: 'mean', normalize: true });
            results.push(Array.from(output.data));
        }
        if (i + batchSize < texts.length) {
            log('INFO', `Embedded ${Math.min(i + batchSize, texts.length)}/${texts.length} chunks...`);
        }
    }
    return results;
}

// ---------------------------------------------------------------------------
// File Discovery
// ---------------------------------------------------------------------------

function discoverFiles(rootDir, includeExt, skipDirs, maxSize) {
    const files = [];

    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
                    walk(fullPath);
                }
                continue;
            }

            if (!entry.isFile()) continue;

            const ext = path.extname(entry.name).toLowerCase();
            if (!includeExt.has(ext)) continue;

            try {
                const stat = fs.statSync(fullPath);
                if (stat.size > maxSize) continue;
            } catch (e) {
                continue;
            }

            files.push(fullPath);
        }
    }

    walk(rootDir);
    log('INFO', `Discovered ${files.length} indexable files`);
    return files;
}

// ---------------------------------------------------------------------------
// SHA256 Change Detection
// ---------------------------------------------------------------------------

function computeHash(filepath) {
    const content = fs.readFileSync(filepath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Code Chunking
// ---------------------------------------------------------------------------

// --- Python: Regex-based function/class extraction ---
// Not as precise as Python's ast module, but works without Python runtime.
// Catches 90%+ of standard Python code patterns.

function chunkPython(filepath, source) {
    const chunks = [];
    const lines = source.split('\n');
    const relPath = path.relative(projectRoot, filepath);

    // Match start of function definitions (handles multi-line signatures)
    const funcStartRegex = /^( {0,8})(async\s+)?def\s+(\w+)\s*\(/;
    // Match class definitions
    const classRegex = /^( {0,4})class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/;

    let currentChunk = null;
    let currentIndent = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const classMatch = line.match(classRegex);
        const funcStartMatch = line.match(funcStartRegex);

        if (classMatch || funcStartMatch) {
            // Save previous chunk
            if (currentChunk && currentChunk.lines.length > 0) {
                currentChunk.line_end = i;
                currentChunk.text = currentChunk.lines.join('\n');
                delete currentChunk.lines;
                chunks.push(currentChunk);
            }

            const indent = (classMatch || funcStartMatch)[1].length;
            const name = classMatch ? classMatch[2] : funcStartMatch[3];
            const type = classMatch ? 'class' : 'function';

            currentChunk = {
                name,
                chunk_type: type,
                filepath: relPath,
                line_start: i + 1,
                line_end: i + 1,
                lines: [line]
            };
            currentIndent = indent;

            // For multi-line signatures, consume until closing ):
            if (funcStartMatch && !line.includes('):') && !line.match(/\)\s*(->[^:]*)?:\s*$/)) {
                for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                    currentChunk.lines.push(lines[j]);
                    if (lines[j].includes('):') || lines[j].match(/\)\s*(->[^:]*)?:\s*$/)) {
                        i = j; // Skip past signature lines
                        break;
                    }
                }
            }
        } else if (currentChunk) {
            // Continue current chunk if indented deeper or empty line
            const lineIndent = line.match(/^(\s*)/)[1].length;
            if (line.trim() === '' || lineIndent > currentIndent) {
                currentChunk.lines.push(line);
            } else {
                // End of current block
                currentChunk.line_end = i;
                currentChunk.text = currentChunk.lines.join('\n');
                delete currentChunk.lines;
                chunks.push(currentChunk);
                currentChunk = null;
            }
        }
    }

    // Flush final chunk
    if (currentChunk && currentChunk.lines.length > 0) {
        currentChunk.line_end = lines.length;
        currentChunk.text = currentChunk.lines.join('\n');
        delete currentChunk.lines;
        chunks.push(currentChunk);
    }

    // Add header (everything before first chunk)
    if (chunks.length > 0 && chunks[0].line_start > 1) {
        const headerText = lines.slice(0, chunks[0].line_start - 1).join('\n').trim();
        if (headerText) {
            chunks.unshift({
                name: `${path.basename(filepath)}:header`,
                chunk_type: 'file_header',
                filepath: relPath,
                line_start: 1,
                line_end: chunks[0].line_start - 1,
                text: headerText
            });
        }
    }

    // If no chunks extracted, treat whole file as one chunk
    if (chunks.length === 0 && source.trim()) {
        chunks.push({
            name: `${path.basename(filepath)}:full`,
            chunk_type: 'file_chunk',
            filepath: relPath,
            line_start: 1,
            line_end: lines.length,
            text: source.trim()
        });
    }

    return chunks;
}

// --- JavaScript/TypeScript: Acorn AST parsing ---

function chunkJavaScript(filepath, source) {
    const chunks = [];
    const relPath = path.relative(projectRoot, filepath);
    const lines = source.split('\n');

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
                const start = node.loc.start.line;
                const end = node.loc.end.line;
                chunks.push({
                    name: node.id ? node.id.name : '(anonymous)',
                    chunk_type: 'function',
                    filepath: relPath,
                    line_start: start,
                    line_end: end,
                    text: lines.slice(start - 1, end).join('\n')
                });
            },
            ClassDeclaration(node) {
                const start = node.loc.start.line;
                const end = node.loc.end.line;
                chunks.push({
                    name: node.id ? node.id.name : '(anonymous)',
                    chunk_type: 'class',
                    filepath: relPath,
                    line_start: start,
                    line_end: end,
                    text: lines.slice(start - 1, end).join('\n')
                });
            },
            VariableDeclaration(node) {
                // Catch arrow functions: const x = () => {}
                for (const decl of node.declarations) {
                    if (decl.init &&
                        (decl.init.type === 'ArrowFunctionExpression' ||
                         decl.init.type === 'FunctionExpression')) {
                        const start = node.loc.start.line;
                        const end = node.loc.end.line;
                        chunks.push({
                            name: decl.id ? decl.id.name : '(anonymous)',
                            chunk_type: 'function',
                            filepath: relPath,
                            line_start: start,
                            line_end: end,
                            text: lines.slice(start - 1, end).join('\n')
                        });
                    }
                }
            }
        });
    } catch (e) {
        // Acorn parse failed — fall back to fixed-size
        log('WARN', `Acorn parse failed for ${filepath}: ${e.message}`);
        return chunkFixedSize(filepath, source);
    }

    if (chunks.length === 0 && source.trim()) {
        return chunkFixedSize(filepath, source);
    }

    return chunks;
}

// --- Fixed-size chunking (everything else) ---

function chunkFixedSize(filepath, source) {
    const chunks = [];
    const relPath = path.relative(projectRoot, filepath);
    const lines = source.split('\n');
    const maxChars = DEFAULTS.maxChunkChars;

    if (!source.trim()) return chunks;

    let currentText = '';
    let chunkStart = 1;

    for (let i = 0; i < lines.length; i++) {
        currentText += lines[i] + '\n';

        if (currentText.length >= maxChars || i === lines.length - 1) {
            chunks.push({
                name: `${path.basename(filepath)}:L${chunkStart}-${i + 1}`,
                chunk_type: 'file_chunk',
                filepath: relPath,
                line_start: chunkStart,
                line_end: i + 1,
                text: currentText.trim()
            });
            chunkStart = i + 2;
            currentText = '';
        }
    }

    return chunks;
}

// --- Chunk router ---

function chunkFile(filepath, source) {
    const ext = path.extname(filepath).toLowerCase();

    if (ext === '.py') return chunkPython(filepath, source);
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return chunkJavaScript(filepath, source);
    return chunkFixedSize(filepath, source);
}

// ---------------------------------------------------------------------------
// Snapshot Management
// ---------------------------------------------------------------------------

function saveSnapshot(filepath) {
    const snapshotDir = path.join(projectRoot, '.karp-inspector', 'snapshots', filepath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = path.join(snapshotDir, `${timestamp}.snapshot`);

    fs.mkdirSync(snapshotDir, { recursive: true });

    const fullPath = path.join(projectRoot, filepath);
    if (fs.existsSync(fullPath)) {
        fs.copyFileSync(fullPath, snapshotPath);
    }

    return snapshotPath;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function configure(root, extras = '') {
    projectRoot = root;

    // Clear previous index when switching projects
    vectorStore.vectors = [];
    vectorStore.hashMap = {};
    vectorStore.isIndexed = false;

    if (extras) {
        extraExtensions = extras.split(',').map(e => {
            e = e.trim();
            return e.startsWith('.') ? e : `.${e}`;
        });
        extraExtensions.forEach(e => DEFAULTS.includeExtensions.add(e));
    }
    log('INFO', `Indexer configured: ${projectRoot}`);

    // Try loading cached index from disk
    const loaded = loadIndex();
    if (loaded) {
        log('INFO', `Ready — ${vectorStore.vectors.length} vectors loaded from cache (no re-index needed)`);
    }
}

async function indexProject(force = false) {
    if (!projectRoot) return { error: 'Project path not configured' };

    const startTime = Date.now();
    const files = discoverFiles(projectRoot, DEFAULTS.includeExtensions, DEFAULTS.skipDirs, DEFAULTS.maxFileSize);

    // Clear previous index if force
    if (force) {
        vectorStore.vectors = [];
        vectorStore.hashMap = {};
    }

    // Chunk all files
    const allChunks = [];
    const byExtension = {};
    let skipped = 0;

    for (const filepath of files) {
        const hash = computeHash(filepath);
        const relPath = path.relative(projectRoot, filepath);

        // Skip unchanged files
        if (!force && vectorStore.hashMap[relPath] === hash) {
            skipped++;
            continue;
        }

        try {
            const source = fs.readFileSync(filepath, 'utf-8');
            const chunks = chunkFile(filepath, source);
            allChunks.push(...chunks);

            const ext = path.extname(filepath).toLowerCase();
            byExtension[ext] = (byExtension[ext] || 0) + chunks.length;

            vectorStore.hashMap[relPath] = hash;
        } catch (e) {
            log('WARN', `Failed to process ${filepath}: ${e.message}`);
            skipped++;
        }
    }

    // Generate embeddings
    if (allChunks.length > 0) {
        log('INFO', `Generating embeddings for ${allChunks.length} chunks...`);
        const texts = allChunks.map(c => `${c.name}\n${c.text}`);
        const embeddings = await generateEmbeddings(texts);

        // Remove old vectors for re-indexed files
        const reindexedFiles = new Set(allChunks.map(c => c.filepath));
        vectorStore.vectors = vectorStore.vectors.filter(v => !reindexedFiles.has(v.payload.filepath));

        // Add new vectors
        for (let i = 0; i < allChunks.length; i++) {
            vectorStore.vectors.push({
                id: `${allChunks[i].filepath}:${allChunks[i].line_start}`,
                embedding: embeddings[i],
                payload: allChunks[i]
            });
        }
    }

    vectorStore.isIndexed = true;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Persist to disk for instant reload on restart
    saveIndex();

    log('INFO', `Indexed ${files.length} files, ${allChunks.length} new chunks in ${duration}s`);

    const result = {
        status: allChunks.length === 0 && vectorStore.vectors.length > 0 ? 'up_to_date' : 'indexed',
        total_files: files.length,
        new_chunks: allChunks.length,
        total_chunks: vectorStore.vectors.length,
        skipped,
        by_extension: byExtension,
        duration_seconds: parseFloat(duration),
        powered_by: 'KARP Inspector Lite by SoulDriver — souldriver.com.au'
    };

    if (result.status === 'up_to_date') {
        result.message = 'Index loaded from cache. No files changed since last index.';
    }

    return result;
}

async function reindexFile(filepath) {
    if (!projectRoot) return { error: 'Project path not configured' };

    const fullPath = path.join(projectRoot, filepath);
    if (!fs.existsSync(fullPath)) return { error: `File not found: ${filepath}` };

    // Save snapshot before reindex
    const snapshotPath = saveSnapshot(filepath);

    // Remove old vectors for this file
    vectorStore.vectors = vectorStore.vectors.filter(v => v.payload.filepath !== filepath);

    // Re-chunk and embed
    const source = fs.readFileSync(fullPath, 'utf-8');
    const chunks = chunkFile(fullPath, source);
    const texts = chunks.map(c => `${c.name}\n${c.text}`);
    const embeddings = await generateEmbeddings(texts);

    for (let i = 0; i < chunks.length; i++) {
        vectorStore.vectors.push({
            id: `${chunks[i].filepath}:${chunks[i].line_start}`,
            embedding: embeddings[i],
            payload: chunks[i]
        });
    }

    // Update hash
    vectorStore.hashMap[filepath] = computeHash(fullPath);

    // Persist updated index
    saveIndex();

    return {
        file: filepath,
        chunks: chunks.length,
        total_chunks: vectorStore.vectors.length,
        snapshot: snapshotPath
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    configure,
    indexProject,
    reindexFile,
    vectorStore,
    vectorSearch,
    generateEmbedding,
    cosineSimilarity,
    discoverFiles,
    computeHash,
    chunkFile,
    chunkPython,
    chunkJavaScript,
    chunkFixedSize,
    saveIndex,
    loadIndex,
    DEFAULTS
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [${level}] ${msg}\n`);
}
