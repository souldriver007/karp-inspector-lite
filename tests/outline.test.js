// ============================================================================
// KARP Inspector Lite — file_outline tests (SQL, shell, bats)
// Usage: npm test (or: npx jest tests/outline.test.js --verbose)
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const searcher = require('../server/searcher');

function outlineOf(name, content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karp-outline-'));
    fs.writeFileSync(path.join(dir, name), content);
    searcher.configure(dir);
    return searcher.fileOutline(name).then(r => {
        fs.rmSync(dir, { recursive: true, force: true });
        return r.outline;
    });
}

describe('SQL outline', () => {
    test('PostgreSQL objects, with line ranges up to the next CREATE', async () => {
        const o = await outlineOf('a.sql', [
            'CREATE TABLE IF NOT EXISTS s.t (',
            '  id int',
            ');',
            'CREATE OR REPLACE FUNCTION s.f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;'
        ].join('\n'));
        expect(o.map(e => [e.type, e.name, e.line_start, e.line_end])).toEqual([
            ['table', 's.t', 1, 3],
            ['function', 's.f', 4, 4]
        ]);
    });

    test('T-SQL: bracketed names, PROC, OR ALTER', async () => {
        const o = await outlineOf('b.sql', [
            'CREATE TABLE [dbo].[T](',
            '[a] int',
            ')',
            'GO',
            'CREATE PROC dbo.p AS SELECT 1',
            'GO',
            'CREATE OR ALTER VIEW dbo.v AS SELECT 1 AS x'
        ].join('\n'));
        expect(o.map(e => [e.type, e.name])).toEqual([
            ['table', '[dbo].[T]'],
            ['procedure', 'dbo.p'],
            ['view', 'dbo.v']
        ]);
    });

    test('index modifiers: UNIQUE, NONCLUSTERED, COLUMNSTORE', async () => {
        const o = await outlineOf('c.sql', [
            'CREATE UNIQUE NONCLUSTERED INDEX uq ON dbo.x (a);',
            'CREATE NONCLUSTERED COLUMNSTORE INDEX ncci ON dbo.x (a, b);',
            'CREATE CLUSTERED COLUMNSTORE INDEX cci ON dbo.x;'
        ].join('\n'));
        expect(o.map(e => [e.type, e.name])).toEqual([
            ['index', 'uq'], ['index', 'ncci'], ['index', 'cci']
        ]);
    });

    test('no CREATE statement falls back to file_info', async () => {
        const o = await outlineOf('d.sql', 'GRANT SELECT ON s.t TO u;\n');
        expect(o).toHaveLength(1);
        expect(o[0].type).toBe('file_info');
    });
});

describe('Shell / Bats outline', () => {
    test('shell functions in both syntaxes', async () => {
        const o = await outlineOf('a.sh', [
            '#!/usr/bin/env bash',
            'log() { echo "$*"; }',
            'function die {',
            '  exit 1',
            '}'
        ].join('\n'));
        expect(o.map(e => [e.type, e.name, e.line_start])).toEqual([
            ['function', 'log', 2],
            ['function', 'die', 3]
        ]);
    });

    test('bats @test blocks and setup', async () => {
        const o = await outlineOf('a.bats', [
            'setup() {',
            '  true',
            '}',
            '@test "refuses without --yes" {',
            '  run true',
            '}'
        ].join('\n'));
        expect(o.map(e => [e.type, e.name])).toEqual([
            ['function', 'setup'],
            ['test', 'refuses without --yes']
        ]);
    });
});
