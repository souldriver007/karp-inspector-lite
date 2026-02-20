// ============================================================================
// KARP Inspector Lite — Basic Tests
// Version: 1.0.0
// Author: SoulDriver (Adelaide, Australia)
// Usage: npm test (or: npx jest tests/basic.test.js --verbose)
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const indexer = require('../server/indexer');

// Helper: create temp project
function createTempProject(files) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karp-test-'));
    for (const [name, content] of Object.entries(files)) {
        const filePath = path.join(tmpDir, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }
    return tmpDir;
}

// Cleanup helper
function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// File Discovery
// ---------------------------------------------------------------------------

describe('File Discovery', () => {
    test('finds Python files', () => {
        const dir = createTempProject({
            'main.py': 'print("hello")',
            'utils.py': 'def add(a, b): return a + b',
            'readme.txt': 'readme'
        });
        const files = indexer.discoverFiles(dir, new Set(['.py']), new Set(), 1048576);
        expect(files.length).toBe(2);
        cleanup(dir);
    });

    test('skips excluded directories', () => {
        const dir = createTempProject({
            'main.py': 'print("hello")',
            'node_modules/junk.py': 'bad',
            '__pycache__/cached.py': 'bad'
        });
        const files = indexer.discoverFiles(dir, new Set(['.py']), new Set(['node_modules', '__pycache__']), 1048576);
        expect(files.length).toBe(1);
        cleanup(dir);
    });

    test('skips large files', () => {
        const dir = createTempProject({
            'small.py': 'x = 1',
            'large.py': 'x'.repeat(2_000_000)
        });
        const files = indexer.discoverFiles(dir, new Set(['.py']), new Set(), 1_000_000);
        expect(files.length).toBe(1);
        cleanup(dir);
    });
});

// ---------------------------------------------------------------------------
// Python Chunking (Regex)
// ---------------------------------------------------------------------------

describe('Python Chunking', () => {
    test('extracts functions', () => {
        const dir = createTempProject({ 'test.py': '' });
        indexer.configure(dir);

        const source = `
def hello(name):
    """Say hello."""
    print(f"Hello {name}")

def goodbye():
    print("Bye")
`;
        const chunks = indexer.chunkPython(path.join(dir, 'test.py'), source);
        const funcs = chunks.filter(c => c.chunk_type === 'function');
        expect(funcs.length).toBe(2);
        expect(funcs[0].name).toBe('hello');
        expect(funcs[1].name).toBe('goodbye');
        cleanup(dir);
    });

    test('extracts classes', () => {
        const dir = createTempProject({ 'test.py': '' });
        indexer.configure(dir);

        const source = `
class MyClass:
    """A class."""
    
    def method(self):
        pass
`;
        const chunks = indexer.chunkPython(path.join(dir, 'test.py'), source);
        const classes = chunks.filter(c => c.chunk_type === 'class');
        expect(classes.length).toBeGreaterThanOrEqual(1);
        expect(classes[0].name).toBe('MyClass');
        cleanup(dir);
    });

    test('handles empty files', () => {
        const dir = createTempProject({ 'empty.py': '' });
        indexer.configure(dir);
        const chunks = indexer.chunkPython(path.join(dir, 'empty.py'), '');
        expect(chunks.length).toBe(0);
        cleanup(dir);
    });
});

// ---------------------------------------------------------------------------
// Fixed-Size Chunking
// ---------------------------------------------------------------------------

describe('Fixed-Size Chunking', () => {
    test('single chunk for small files', () => {
        const dir = createTempProject({ 'small.html': '' });
        indexer.configure(dir);
        const chunks = indexer.chunkFixedSize(path.join(dir, 'small.html'), '<html><body>Hello</body></html>');
        expect(chunks.length).toBe(1);
        cleanup(dir);
    });

    test('multiple chunks for large files', () => {
        const dir = createTempProject({ 'big.txt': '' });
        indexer.configure(dir);
        const source = Array.from({ length: 200 }, (_, i) => `Line ${i}: Some content`).join('\n');
        const chunks = indexer.chunkFixedSize(path.join(dir, 'big.txt'), source);
        expect(chunks.length).toBeGreaterThan(1);
        cleanup(dir);
    });
});

// ---------------------------------------------------------------------------
// SHA256 Hashing
// ---------------------------------------------------------------------------

describe('SHA256 Hashing', () => {
    test('consistent hash', () => {
        const dir = createTempProject({ 'test.py': 'hello world' });
        const filepath = path.join(dir, 'test.py');
        const h1 = indexer.computeHash(filepath);
        const h2 = indexer.computeHash(filepath);
        expect(h1).toBe(h2);
        cleanup(dir);
    });

    test('different content = different hash', () => {
        const dir = createTempProject({
            'a.py': 'hello',
            'b.py': 'world'
        });
        const h1 = indexer.computeHash(path.join(dir, 'a.py'));
        const h2 = indexer.computeHash(path.join(dir, 'b.py'));
        expect(h1).not.toBe(h2);
        cleanup(dir);
    });
});

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

describe('Cosine Similarity', () => {
    test('identical vectors score 1.0', () => {
        const v = [1, 2, 3, 4, 5];
        expect(indexer.cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    test('orthogonal vectors score 0.0', () => {
        const a = [1, 0, 0];
        const b = [0, 1, 0];
        expect(indexer.cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    test('opposite vectors score -1.0', () => {
        const a = [1, 0, 0];
        const b = [-1, 0, 0];
        expect(indexer.cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });
});
