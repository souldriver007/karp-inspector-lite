// ============================================================================
// KARP Inspector Lite — MCP Server (Node.js, stdio)
// Version: 1.0.0
// Author: SoulDriver (Adelaide, Australia)
// Description: Zero-dependency MCP server for Claude Desktop. Handles protocol,
//              routes tool calls to indexer and searcher modules.
// License: MIT
// ============================================================================

const readline = require('readline');
const path = require('path');

// Import modules
const indexer = require('./indexer');
const searcher = require('./searcher');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VERSION = '1.0.0';
const SERVER_NAME = 'karp-inspector-lite';
const PROJECT_PATH = process.env.PROJECT_PATH || '';
const EXTRA_EXTENSIONS = process.env.EXTRA_EXTENSIONS || '';

// Logging to stderr (stdout reserved for MCP protocol)
function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const TOOLS = [
    {
        name: 'search_code',
        description: 'Semantic search across your codebase using natural language. Returns matching functions, classes, and code blocks with file paths and line numbers. Use for finding code by meaning — e.g. "authentication logic", "database connection setup", "payment handling". For exact variable names or strings, use grep_code instead. Requires index_project to have been run first.',
        annotations: { title: 'Semantic Code Search', readOnlyHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language or code search query' },
                limit: { type: 'integer', description: 'Max results (default 8)', default: 8 },
                file_filter: { type: 'string', description: 'Filter by filename substring' },
                ext_filter: { type: 'string', description: 'Filter by extension (.py, .js, etc.)' }
            },
            required: ['query']
        }
    },
    {
        name: 'grep_code',
        description: 'Exact string or regex search across the codebase. Returns matching lines with context. Use for exact variable names, imports, error messages, or literal strings. For finding code by concept or meaning, use search_code instead.',
        annotations: { title: 'Grep Code Search', readOnlyHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'String or regex pattern to search' },
                is_regex: { type: 'boolean', description: 'Treat as regex', default: false },
                case_sensitive: { type: 'boolean', description: 'Case-sensitive', default: true },
                limit: { type: 'integer', description: 'Max matches', default: 50 },
                context_lines: { type: 'integer', description: 'Context lines around match', default: 2 },
                file_filter: { type: 'string', description: 'Filter by filename' },
                ext_filter: { type: 'string', description: 'Filter by extension' }
            },
            required: ['pattern']
        }
    },
    {
        name: 'file_outline',
        description: 'Structural outline of any file — classes, methods, functions with signatures and line numbers — without loading content.',
        annotations: { title: 'File Outline', readOnlyHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'Relative path from project root' },
                include_body: { type: 'boolean', description: 'Include first 5 lines of body', default: false }
            },
            required: ['filepath']
        }
    },
    {
        name: 'index_project',
        description: 'Index or re-index the project. Run this before using search_code for the first time on a project. Only processes changed files via SHA256 detection. First run downloads a small embedding model (~50MB). Subsequent runs load from disk cache in under a second.',
        annotations: { title: 'Index Project', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                force: { type: 'boolean', description: 'Re-index all files', default: false }
            }
        }
    },
    {
        name: 'reindex_file',
        description: 'Re-index a single file after editing to keep search results current. Saves a snapshot for version tracking.',
        annotations: { title: 'Re-index File', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'Relative path from project root' }
            },
            required: ['filepath']
        }
    },
    {
        name: 'file_history',
        description: 'List saved snapshots of a file.',
        annotations: { title: 'File History', readOnlyHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'Relative path from project root' }
            },
            required: ['filepath']
        }
    },
    {
        name: 'file_diff',
        description: 'Diff between two snapshots of a file.',
        annotations: { title: 'File Diff', readOnlyHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'Relative path from project root' },
                old_index: { type: 'integer', description: 'Older snapshot (0=latest, 1=previous)', default: 1 },
                new_index: { type: 'integer', description: 'Newer snapshot (0=latest, -1=live)', default: 0 }
            },
            required: ['filepath']
        }
    },
    {
        name: 'project_stats',
        description: 'Index statistics — files, chunks, extensions. Use to verify the project is indexed and check coverage before searching.',
        annotations: { title: 'Project Stats', readOnlyHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'set_project',
        description: 'Switch to a different project directory. Loads cached index if available, otherwise you will need to run index_project.',
        annotations: { title: 'Switch Project', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                project_path: { type: 'string', description: 'Absolute path to the project directory' }
            },
            required: ['project_path']
        }
    }
];

// ---------------------------------------------------------------------------
// Tool Router
// ---------------------------------------------------------------------------

async function handleToolCall(name, args) {
    switch (name) {
        case 'search_code':
            return await searcher.searchCode(args.query, args.limit, args.file_filter, args.ext_filter);

        case 'grep_code':
            return await searcher.grepCode(args.pattern, args.is_regex, args.case_sensitive, args.limit, args.context_lines, args.file_filter, args.ext_filter);

        case 'file_outline':
            return await searcher.fileOutline(args.filepath, args.include_body);

        case 'index_project':
            return await indexer.indexProject(args.force);

        case 'reindex_file':
            return await indexer.reindexFile(args.filepath);

        case 'file_history':
            return await searcher.fileHistory(args.filepath);

        case 'file_diff':
            return await searcher.fileDiff(args.filepath, args.old_index, args.new_index);

        case 'project_stats':
            return await searcher.projectStats();

        case 'set_project': {
            const newPath = args.project_path;
            const fs = require('fs');
            if (!fs.existsSync(newPath) || !fs.statSync(newPath).isDirectory()) {
                return { error: `Directory not found: ${newPath}` };
            }
            // Reconfigure both modules
            indexer.configure(newPath, EXTRA_EXTENSIONS);
            searcher.configure(newPath);
            const hasCache = indexer.vectorStore.isIndexed;
            return {
                status: 'switched',
                project_path: newPath,
                index_loaded: hasCache,
                total_chunks: indexer.vectorStore.vectors.length,
                message: hasCache
                    ? `Switched to ${newPath} — cached index loaded (${indexer.vectorStore.vectors.length} vectors). Ready to search.`
                    : `Switched to ${newPath} — no cached index found. Run index_project to build the index.`
            };
        }

        default:
            return { error: `Unknown tool: ${name}` };
    }
}

// ---------------------------------------------------------------------------
// MCP Protocol Handler
// ---------------------------------------------------------------------------

async function handleMessage(message) {
    const { method, id, params = {} } = message;

    // --- Initialize ---
    if (method === 'initialize') {
        log('INFO', `Initializing ${SERVER_NAME} v${VERSION}`);
        log('INFO', `Project: ${PROJECT_PATH || '(not configured)'}`);

        // Configure modules
        if (PROJECT_PATH) {
            indexer.configure(PROJECT_PATH, EXTRA_EXTENSIONS);
            searcher.configure(PROJECT_PATH);
        }

        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: SERVER_NAME, version: VERSION }
            }
        };
    }

    // --- Initialized notification ---
    if (method === 'notifications/initialized') {
        log('INFO', 'Client connected');
        return null; // No response for notifications
    }

    // --- List tools ---
    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0',
            id,
            result: { tools: TOOLS }
        };
    }

    // --- Call tool ---
    if (method === 'tools/call') {
        const toolName = params.name || '';
        const toolArgs = params.arguments || {};

        try {
            const result = await handleToolCall(toolName, toolArgs);
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2)
                    }]
                }
            };
        } catch (err) {
            log('ERROR', `Tool error [${toolName}]: ${err.message}`);
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ error: err.message })
                    }],
                    isError: true
                }
            };
        }
    }

    // --- Ping ---
    if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
    }

    // --- Unknown ---
    log('WARN', `Unknown method: ${method}`);
    return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
    };
}

// ---------------------------------------------------------------------------
// Main — stdio loop
// ---------------------------------------------------------------------------

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
        const message = JSON.parse(trimmed);
        const response = await handleMessage(message);
        if (response !== null) {
            process.stdout.write(JSON.stringify(response) + '\n');
        }
    } catch (err) {
        log('ERROR', `Parse error: ${err.message}`);
    }
});

log('INFO', `${SERVER_NAME} v${VERSION} starting (stdio mode)`);
