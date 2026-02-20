# KARP Inspector Lite

### One-Click Semantic Codebase Search for Claude Desktop

**Version:** 1.0.0
**Author:** [SoulDriver](https://souldriver.com.au) (Adelaide, Australia)
**License:** MIT

---

## What Is This?

KARP Inspector Lite gives Claude the ability to search your entire codebase by meaning, not just filenames. Ask Claude *"find the login logic"* and it returns the exact functions — with file paths and line numbers.

**Zero API keys. Zero setup. Zero dependencies. One click.**

Claude Desktop ships with Node.js built in. This extension uses it — nothing else to install.

> Your code never leaves your machine. Everything runs locally.

## Installation

### Option A: Download the Extension (Recommended)

1. Download `karp-inspector-lite.mcpb` from [Releases](https://github.com/souldriver007/karp-inspector-lite/releases)
2. Open Claude Desktop → **Settings → Extensions → Install Extension**
3. Select the `.mcpb` file
4. Choose your project folder when prompted
5. Say: *"Index my project"*
6. Start searching naturally

**That's it.** No terminal. No config files. No installs.

### Option B: Manual Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "karp-inspector": {
      "command": "node",
      "args": ["C:/path/to/Karp_Inspector_Lite/server/index.js"],
      "env": {
        "PROJECT_PATH": "C:/path/to/your/project"
      }
    }
  }
}
```

### Option C: Claude Code

```bash
claude mcp add karp-inspector -- node /path/to/server/index.js
```

Or add `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "karp-inspector": {
      "command": "node",
      "args": ["/path/to/Karp_Inspector_Lite/server/index.js"],
      "env": { "PROJECT_PATH": "." }
    }
  }
}
```

## What Can It Do?

| Just ask Claude... | What happens |
|---|---|
| *"Find the authentication logic"* | Semantic search across your codebase |
| *"Find every call to validateToken"* | Exact string grep with context |
| *"Show me the structure of server.py"* | File outline — classes, functions, line numbers |
| *"Index my project"* | Builds searchable index (~60s first time, instant after) |
| *"What changed in auth.js?"* | Diff between saved file versions |
| *"Switch to my other project"* | Loads a different codebase (with cached index) |

## Tools (9)

| Tool | Description |
|---|---|
| `search_code` | Semantic search by meaning — *"authentication logic"*, *"payment handling"*. For exact strings, use `grep_code`. |
| `grep_code` | Exact string or regex search — variable names, imports, error messages. For concepts, use `search_code`. |
| `file_outline` | Structural outline of any file — classes, methods, functions with signatures and line numbers — without loading content. |
| `index_project` | Index or re-index the project. Run before first `search_code` use. Loads from disk cache in under a second on subsequent runs. |
| `reindex_file` | Re-index a single file after editing to keep search results current. Saves a snapshot for version tracking. |
| `file_history` | List saved snapshots of a file with timestamps and sizes. |
| `file_diff` | Diff between two snapshots of a file, or compare against the current live file. |
| `project_stats` | Index statistics — files, chunks, extensions. Use to verify the project is indexed and check coverage. |
| `set_project` | Switch to a different project directory. Loads cached index if available, otherwise run `index_project`. |

## How It Works

1. **Index** — Reads your code files, splits them into meaningful chunks (functions, classes, sections), and creates vector embeddings using a local ONNX model
2. **Cache** — Saves the index to disk so restarts are instant (0.07s vs 60s)
3. **Search** — Converts your question into a vector and finds the closest matching code chunks via cosine similarity
4. **Return** — Claude gets back the relevant code with file paths and line numbers, not your entire codebase

The embedding model (~50MB) downloads automatically on first use. After that, everything works offline.

## Performance

| Scenario | Time |
|---|---|
| First index (261 files, with model download) | ~66s |
| Restart, no changes (cache load) | 0.07s |
| Restart, 5 files changed | ~3s |
| Semantic search | <1s |
| Grep search | Instant |
| Project switching (cached) | Instant |

## Supported Languages

Python, JavaScript, TypeScript, HTML, CSS, Markdown, and plain text out of the box. Add more via the `EXTRA_EXTENSIONS` environment variable.

**Parsing quality:**

| Language | Parser | Quality |
|---|---|---|
| JavaScript / TypeScript | Acorn AST | Excellent — full function/class extraction |
| Python | Regex + indentation | Good — handles classes, functions, decorators, multi-line signatures |
| HTML | Script/style extraction | Good — extracts embedded JS/CSS blocks |
| CSS / Markdown / Text | Section-based chunking | Good — splits on headers and logical breaks |

## Requirements

- **Claude Desktop** (Windows or macOS) — that's it
- ~50MB disk for the embedding model (downloaded once, automatically)
- No Python, no Docker, no API keys, no external services

## Building from Source

```bash
git clone https://github.com/souldriver007/karp-inspector-lite.git
cd karp-inspector-lite
npm install
npm test                    # Run test suite (13 tests)
node scripts/build_mcpb.js  # Build .mcpb extension
```

The built extension will be at `dist/karp-inspector-lite.mcpb`.

## Project Structure

```
karp-inspector-lite/
├── server/
│   ├── index.js        # MCP protocol handler + tool router
│   ├── indexer.js       # File discovery, chunking, embedding, caching
│   └── searcher.js      # Vector search, grep, outline, diff, stats
├── config/
│   └── manifest.json    # MCPB extension manifest
├── assets/
│   └── icon.png         # SoulDriver branding (256x256)
├── scripts/
│   └── build_mcpb.js    # Extension packager
├── tests/
│   └── run_tests.js     # Test suite
├── docs/
│   ├── DESIGN_DOC.md    # Architecture decisions
│   └── CHANGELOG.md     # Version history
├── package.json
├── LICENSE              # MIT
└── README.md            # This file
```

## How Is This Different?

| Tool | API Keys | External Services | Install Complexity | Model Size |
|---|---|---|---|---|
| Zilliz Claude Context | OpenAI + Zilliz | Milvus Cloud | High | Cloud |
| claude-context-local | None | FAISS + Python + CUDA | High | 1.2GB |
| mcp-codebase-index | Gemini + Qdrant | Qdrant Cloud + Gemini | High | Cloud |
| Codebase MCP | Ollama | PostgreSQL + pgvector | Very High | Varies |
| **KARP Inspector Lite** | **None** | **None** | **Double-click** | **50MB** |

**Key differentiators:**
- Zero API keys — ONNX embeddings run locally
- Zero external services — in-memory vector store
- Zero Python — Node.js ships with Claude Desktop
- One-click `.mcpb` install — no terminal, no config editing
- Disk persistence — instant restart, no re-indexing
- Multi-project support — switch between codebases with cached indexes
- 9 tools — search, grep, outline, diff, history, stats, index, reindex, project switching

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

**Built in Adelaide, Australia by [SoulDriver](https://souldriver.com.au)**
*Part of the KARP ecosystem — Knowledge Acquisition Research Protocol*
*Democratising access to intelligent tools.*
