# Changelog

All notable changes to KARP Inspector Lite will be documented in this file.

## [1.0.0] - 2026-02-21

### Initial Release

**9 MCP Tools:**
- `search_code` — Semantic search across codebases using local ONNX embeddings
- `grep_code` — Exact string/regex search with configurable context
- `file_outline` — AST-parsed structural outlines (Python, JS/TS, HTML, Markdown)
- `index_project` — Smart indexing with SHA256 change detection
- `reindex_file` — Single-file re-index with snapshot versioning
- `file_history` — List saved file snapshots
- `file_diff` — Unified diff between file snapshots
- `project_stats` — Index health dashboard
- `set_project` — Multi-project switching with per-project caches

**Core Features:**
- Zero dependencies — runs on Claude Desktop's built-in Node.js
- Zero API keys — ONNX embeddings via @xenova/transformers
- One-click `.mcpb` install with GUI project folder picker
- Disk persistence — 0.07s restart vs 68s re-index (970x improvement)
- Full-stack search — Python backend + JS/HTML frontend in one query
- Multi-line Python function signature parsing
- HTML embedded script/style extraction
- Incremental indexing — only re-embeds changed files

**Test Results:**
- 13/13 unit tests passing
- 261 files indexed, 2383 chunks
- Semantic search <1s across full index
- Tested on Windows 11 with Claude Desktop

**Technical Details:**
- Embedding model: bge-small-en-v1.5 (384 dimensions, ~130MB ONNX)
- Vector similarity: Cosine similarity with in-memory search
- Cache format: JSON with version validation
- Protocol: MCP over stdio (JSON-RPC 2.0)
