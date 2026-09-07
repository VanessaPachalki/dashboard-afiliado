#!/usr/bin/env node
// ================================================
// SPACEHUB Build Script
// Minifica, ofusca e prepara dist/ para deploy
// ================================================

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');
const CleanCSS = require('clean-css');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Files to process
const HTML_FILES = ['index.html', 'dashboard.html', 'upload.html', 'admin.html', 'conta.html', 'fechamento.html', 'superadmin.html', 'settings.html', 'termos.html', 'privacidade.html'];
const JS_FILES = ['supabase-config.js', 'tenant.js', 'auth.js', 'dashboard.js', 'upload.js', 'admin.js', 'fechamento.js', 'superadmin.js', 'settings.js', 'tiktok-config.js'];
const CSS_FILES = ['style.css'];

// Obfuscation config — high protection, good performance
const OBFUSCATOR_OPTS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,          // keep globals (esc, sb, etc.) accessible from HTML onclick
  selfDefending: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

// Terser config
const TERSER_OPTS = {
  compress: {
    drop_console: false,   // keep console.log for debugging in prod
    passes: 2
  },
  mangle: {
    reserved: ['sb', 'esc', 'escAttr', 'supabase']  // keep Supabase globals
  }
};

// Fingerprint — invisible watermark
const WATERMARK = `\n/* __s:{p:"SPACEHUB",v:"1.0",r:"INPI-2026",b:"${new Date().toISOString()}"} */\n`;

async function clean() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'css'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'sql'), { recursive: true });
}

async function processJS() {
  for (const file of JS_FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8');

    // Step 1: Minify with Terser
    const minified = await minify(src, TERSER_OPTS);
    if (minified.error) {
      console.error(`Terser error in ${file}:`, minified.error);
      process.exit(1);
    }

    // Step 2: Obfuscate
    const obfuscated = JavaScriptObfuscator.obfuscate(minified.code, {
      ...OBFUSCATOR_OPTS,
      inputFileName: file,
      sourceMap: false
    });

    // Step 3: Add watermark
    const final = WATERMARK + obfuscated.getObfuscatedCode();

    fs.writeFileSync(path.join(DIST, 'js', file), final);
    const ratio = ((1 - final.length / src.length) * 100).toFixed(0);
    console.log(`  JS: ${file} (${src.length} → ${final.length} bytes, ${ratio > 0 ? ratio + '% smaller' : 'obfuscated'})`);
  }
}

function processCSS() {
  const cleanCSS = new CleanCSS({ level: 2 });
  for (const file of CSS_FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'css', file), 'utf8');
    const result = cleanCSS.minify(src);
    if (result.errors.length) {
      console.error(`CleanCSS error in ${file}:`, result.errors);
      process.exit(1);
    }
    fs.writeFileSync(path.join(DIST, 'css', file), result.styles);
    const ratio = ((1 - result.styles.length / src.length) * 100).toFixed(0);
    console.log(`  CSS: ${file} (${src.length} → ${result.styles.length} bytes, ${ratio}% smaller)`);
  }
}

function copyHTML() {
  for (const file of HTML_FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // HTML stays as-is — JS/CSS paths are the same relative paths
    fs.writeFileSync(path.join(DIST, file), src);
    console.log(`  HTML: ${file}`);
  }
}

function copyStatic() {
  // Copy SQL files (for reference, not served)
  const sqlDir = path.join(ROOT, 'sql');
  if (fs.existsSync(sqlDir)) {
    fs.readdirSync(sqlDir).forEach(f => {
      fs.copyFileSync(path.join(sqlDir, f), path.join(DIST, 'sql', f));
    });
  }
  console.log('  Static: sql/');
}

async function build() {
  console.log('\n🔧 SPACEHUB Build\n');

  console.log('Cleaning dist/...');
  await clean();

  console.log('Processing JS (minify + obfuscate)...');
  await processJS();

  console.log('Processing CSS (minify)...');
  processCSS();

  console.log('Copying HTML...');
  copyHTML();

  console.log('Copying static assets...');
  copyStatic();

  console.log('\n✅ Build complete → dist/\n');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
