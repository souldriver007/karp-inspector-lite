// ============================================================================
// KARP Inspector Lite — MCPB Build Script
// Version: 1.1.0
// Author: SoulDriver (Adelaide, Australia)
// Usage: node scripts/build_mcpb.js
//
// Creates a .mcpb bundle (ZIP) with the correct structure:
//   karp-inspector-lite.mcpb
//   ├── manifest.json
//   ├── server/
//   │   ├── index.js
//   │   ├── indexer.js
//   │   └── searcher.js
//   ├── node_modules/   (production deps only)
//   ├── package.json
//   └── icon.png        (if exists)
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'dist', 'stage');
const OUTPUT = path.join(ROOT, 'dist', 'karp-inspector-lite.mcpb');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
}

function fileSize(filepath) {
    const bytes = fs.statSync(filepath).size;
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    if (bytes > 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${bytes}B`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

console.log('╔══════════════════════════════════════════════╗');
console.log('║  KARP Inspector Lite — MCPB Bundle Builder   ║');
console.log('║  by SoulDriver (souldriver.com.au)           ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

// Step 1: Verify package.json exists
console.log('[1/5] Checking project...');
if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
    console.error('      ✗ package.json not found!');
    process.exit(1);
}
console.log('      ✓ package.json found');

// Step 2: Clean staging directory
console.log('[2/5] Preparing staging directory...');
cleanDir(STAGE);
console.log('      ✓ dist/stage cleaned');

// Step 3: Copy files to staging
console.log('[3/5] Staging files...');

// manifest.json → root of bundle (from config/)
fs.copyFileSync(
    path.join(ROOT, 'config', 'manifest.json'),
    path.join(STAGE, 'manifest.json')
);
console.log('      ✓ manifest.json');

// package.json
fs.copyFileSync(
    path.join(ROOT, 'package.json'),
    path.join(STAGE, 'package.json')
);
console.log('      ✓ package.json');

// server/
copyDir(path.join(ROOT, 'server'), path.join(STAGE, 'server'));
console.log('      ✓ server/ (index.js, indexer.js, searcher.js)');

// node_modules/ (PRODUCTION ONLY — strips jest, babel, istanbul, etc.)
console.log('      Installing production dependencies only (this strips dev deps)...');
execSync('npm install --production --no-optional', { cwd: STAGE, stdio: 'inherit' });
console.log('      ✓ node_modules/ (production dependencies only)');

// icon.png (optional)
const iconPath = path.join(ROOT, 'assets', 'icon.png');
if (fs.existsSync(iconPath)) {
    fs.copyFileSync(iconPath, path.join(STAGE, 'icon.png'));
    console.log('      ✓ icon.png');
} else {
    console.log('      ⚠ icon.png not found (optional — add to assets/)');
}

// Step 4: Create ZIP using PowerShell (Windows) or zip (Unix)
console.log('[4/5] Creating .mcpb bundle...');

// Remove old output
if (fs.existsSync(OUTPUT)) {
    fs.unlinkSync(OUTPUT);
}

const isWindows = process.platform === 'win32';

try {
    if (isWindows) {
        // PowerShell only supports .zip — create as .zip then rename
        const zipPath = OUTPUT.replace(/\.mcpb$/, '.zip');
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        const psCmd = `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${zipPath}' -Force`;
        execSync(`powershell -Command "${psCmd}"`, { stdio: 'inherit' });
        fs.renameSync(zipPath, OUTPUT);
    } else {
        // Unix zip
        execSync(`cd "${STAGE}" && zip -r "${OUTPUT}" .`, { stdio: 'inherit' });
    }
    console.log(`      ✓ Bundle created: ${OUTPUT}`);
} catch (e) {
    console.error(`      ✗ ZIP creation failed: ${e.message}`);
    console.log('');
    console.log('      Manual alternative:');
    console.log(`      1. Open: ${STAGE}`);
    console.log('      2. Select all files → right-click → Send to → Compressed folder');
    console.log(`      3. Rename to: karp-inspector-lite.mcpb`);
    process.exit(1);
}

// Step 5: Summary
console.log('[5/5] Build complete!');
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  BUILD SUMMARY                               ║');
console.log('╠══════════════════════════════════════════════╣');
console.log(`║  Output:  ${path.basename(OUTPUT)}`);
console.log(`║  Size:    ${fileSize(OUTPUT)}`);
console.log(`║  Path:    ${OUTPUT}`);
console.log('╠══════════════════════════════════════════════╣');
console.log('║  TO INSTALL:                                 ║');
console.log('║  1. Open Claude Desktop                      ║');
console.log('║  2. Settings → Extensions → Install Extension║');
console.log('║  3. Select the .mcpb file                    ║');
console.log('║  4. Enter your project path when prompted    ║');
console.log('╚══════════════════════════════════════════════╝');

// Cleanup staging
console.log('');
console.log('Cleaning up staging directory...');
fs.rmSync(STAGE, { recursive: true, force: true });
console.log('Done! 🚀');
