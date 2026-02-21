# KARP Inspector Lite — Design Document
**Version:** 1.0.0 | **Date:** February 21, 2026 | **Author:** SoulDriver

---

## Architecture

```
Claude Desktop (built-in Node.js runtime)
    │ stdio (MCP protocol)
    │
    ▼
index.js ─── MCP protocol handler, tool routing
    │
    ├── indexer.js
    │   ├── File discovery (walk + filter)
    │   ├── Python chunking (regex-based)
    │   ├── JS/TS chunking (Acorn AST)
    │   ├── Fixed-size chunking (everything else)
    │   ├── ONNX embeddings (@xenova/transformers)
    │   ├── In-memory vector store (cosine similarity)
    │   └── SHA256 change detection
    │
    └── searcher.js
        ├── Semantic search (vector similarity)
        ├── Grep (exact string / regex)
        ├── File outline (regex for Python, Acorn for JS)
        ├── Snapshot history
        ├── File diff
        └── Project stats
```

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Language | Node.js | Ships with Claude Desktop — zero install |
| Embeddings | @xenova/transformers ONNX | 130MB, runs in Node, no Python/PyTorch |
| Vector store | In-memory JSON array | No Qdrant, no DB, brute-force cosine <100ms |
| Python parsing | Regex | Works without Python runtime installed |
| JS/TS parsing | Acorn AST | Proper AST, ships as npm dependency |
| Diff | Custom line-by-line | No external diff library needed |

## Trade-offs vs Heavy Version

| | Lite | Heavy |
|---|---|---|
| Install friction | Zero | Python + pip + PyTorch |
| Embedding quality | Good (384-dim ONNX) | Best (1024-dim bge-m3) |
| Python parsing | ~90% accuracy (regex) | ~99% accuracy (AST) |
| Max codebase size | ~100k lines comfortable | Unlimited (Qdrant scales) |
| Vector search speed | <100ms brute-force | <10ms Qdrant HNSW |

Both versions share: same 8 tools, same MCP protocol, same SoulDriver branding.

---

*Built in Adelaide, Australia by SoulDriver — souldriver.com.au*
