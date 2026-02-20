# Contributing to KARP Inspector Lite

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/souldriver007/karp-inspector-lite.git
cd karp-inspector-lite
npm install
```

## Running Tests

```bash
npm test
```

All 13 tests must pass before submitting a PR.

## Testing with Claude Desktop

1. Edit your `claude_desktop_config.json` to point at your local `server/index.js`
2. Restart Claude Desktop
3. Test your changes interactively

## Code Style

- Vanilla JavaScript (no TypeScript, no transpilation)
- All logging to `stderr` (stdout is reserved for MCP protocol)
- Version headers on all files
- Functions documented with JSDoc-style comments

## What We're Looking For

**Good first issues:**
- Additional language parsers (Rust, Go, Java, C#)
- Better Python AST parsing (tree-sitter integration)
- Cache compression (22MB JSON → binary format)
- macOS testing and bug reports

**Feature ideas:**
- Symbol-level search (find all callers of a function)
- Cross-file reference tracking
- Git-aware indexing (only index tracked files)
- Workspace support (multiple project roots)

## Pull Request Process

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `npm test` — all tests must pass
5. Submit a PR with a clear description of what changed and why

## Architecture

- `server/index.js` — MCP protocol handler, tool routing
- `server/indexer.js` — File discovery, chunking, embedding generation, disk cache
- `server/searcher.js` — Vector search, grep, file outline, diff engine

The server communicates over stdio using JSON-RPC 2.0 (MCP protocol). Claude Desktop sends tool calls, the server returns results.

## Reporting Issues

Please include:
- OS and version (Windows 10/11, macOS version)
- Claude Desktop version
- Error messages from the extension logs
- Steps to reproduce

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

*Built by [SoulDriver](https://souldriver.com.au) — Adelaide, Australia*
