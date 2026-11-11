#!/usr/bin/env node
'use strict';
// Builds the PromptGate Video APK with the plain Android SDK command-line tools (no Gradle):
//   aapt2 compile/link → javac → d8 → zipalign → apksigner.
// Needs a JDK (17+) and an Android SDK with build-tools and one platform:
//   ANDROID_HOME=/path/to/sdk node android/build.js
// Signing: set PGV_KEYSTORE, PGV_KS_PASS, PGV_KEY_ALIAS to use your own key. Without them a
// local debug key is created once in android/build/ and reused on this machine.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const APP = path.resolve(HERE, '..');
const SRC = path.join(HERE, '..', 'src');
const OUT = path.join(HERE, 'build');
const DIST = path.join(HERE, '..', 'dist');
const WEB_FILES = ['index.html', 'style.css', 'core.js', 'render.js', 'i18n.js', 'app.js'];
const ICONS = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const MIN_SDK = 24, TARGET_SDK = 34;
const APP_ID = 'com.promptgate.video';
const VERSION = { name: '0.3.0', code: 3 };
const WIN = process.platform === 'win32';

function byVersion(a, b) { return a.localeCompare(b, undefined, { numeric: true }); }

// Copies the web app and generates the launcher icons. Pure Node, no SDK needed (tested).
function stage(outDir) {
  const out = outDir || OUT;
  fs.rmSync(path.join(out, 'stage'), { recursive: true, force: true });
  const www = path.join(out, 'stage', 'assets', 'www');
  fs.mkdirSync(www, { recursive: true });
  for (const f of WEB_FILES) fs.copyFileSync(path.join(SRC, f), path.join(www, f));
  const { png } = require('./icons.js');
  for (const [density, size] of Object.entries(ICONS)) {
    const dir = path.join(out, 'stage', 'res', 'mipmap-' + density);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png(size));
  }
  return { assets: path.join(out, 'stage', 'assets'), res: path.join(out, 'stage', 'res') };
}

function findSdk(env) {
  const home = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  const fail = (msg) => { throw new Error(msg + '\nCài Android SDK (Android Studio hoặc command-line tools) rồi đặt ANDROID_HOME. / Install the Android SDK and set ANDROID_HOME.'); };
  if (!home || !fs.existsSync(home)) fail('Không tìm thấy Android SDK (ANDROID_HOME chưa đặt).');
  const pick = (dir, ok) => {
    const base = path.join(home, dir);
    const names = fs.existsSync(base) ? fs.readdirSync(base).filter((n) => ok(path.join(base, n))).sort(byVersion) : [];
    return names.length ? path.join(base, names[names.length - 1]) : null;
  };
  const exe = (n) => (WIN ? n + '.exe' : n);
  const tools = pick('build-tools', (d) => fs.existsSync(path.join(d, exe('aapt2'))) && fs.existsSync(path.join(d, 'lib', 'd8.jar')));
  const platform = pick('platforms', (d) => fs.existsSync(path.join(d, 'android.jar')));
  if (!tools) fail('SDK thiếu build-tools (aapt2, d8).');
  if (!platform) fail('SDK thiếu platform (android.jar).');
  return {
    aapt2: path.join(tools, exe('aapt2')), zipalign: path.join(tools, exe('zipalign')),
    d8: path.join(tools, 'lib', 'd8.jar'), apksigner: path.join(tools, 'lib', 'apksigner.jar'),
    androidJar: path.join(platform, 'android.jar'),
  };
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...(opts || {}) });
  if (r.error) throw new Error(`${path.basename(cmd)}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args[0] || ''} failed (${r.status})\n${r.stdout || ''}${r.stderr || ''}`);
  return r.stdout || '';
}
function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []));
}

function keystore(env) {
  if (env.PGV_KEYSTORE) {
    if (!env.PGV_KS_PASS) throw new Error('PGV_KEYSTORE is set but PGV_KS_PASS is not.');
    return { file: env.PGV_KEYSTORE, alias: env.PGV_KEY_ALIAS || 'pgvideo', own: true };
  }
  const file = path.join(OUT, 'debug.keystore');
  if (!fs.existsSync(file)) {
    run('keytool', ['-genkeypair', '-keystore', file, '-storepass', 'android', '-keypass', 'android', '-alias', 'pgvideo', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=PromptGate Video debug']);
  }
  return { file, alias: 'pgvideo', own: false };
}

function build(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const log = o.quiet ? () => {} : (m) => console.log(m);
  const sdk = findSdk(env);
  fs.mkdirSync(OUT, { recursive: true });
  const st = stage();
  for (const d of ['classes', 'dex']) { fs.rmSync(path.join(OUT, d), { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, d)); }
  const resZip = path.join(OUT, 'res.zip'), unsigned = path.join(OUT, 'unsigned.apk'), aligned = path.join(OUT, 'aligned.apk');
  for (const f of [resZip, unsigned, aligned]) fs.rmSync(f, { force: true });

  log('aapt2: resources + manifest');
  run(sdk.aapt2, ['compile', '--dir', st.res, '-o', resZip]);
  run(sdk.aapt2, ['link', '-o', unsigned, '-I', sdk.androidJar, '--manifest', path.join(HERE, 'AndroidManifest.xml'), '-A', st.assets,
    '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(TARGET_SDK), '--version-code', String(VERSION.code), '--version-name', VERSION.name, resZip]);

  log('javac + d8');
  run('javac', ['--release', '8', '-Xlint:-options', '-cp', sdk.androidJar, '-d', path.join(OUT, 'classes'), ...walk(path.join(HERE, 'src'), '.java')]);
  run('java', ['-cp', sdk.d8, 'com.android.tools.r8.D8', '--release', '--lib', sdk.androidJar, '--min-api', String(MIN_SDK), '--output', path.join(OUT, 'dex'), ...walk(path.join(OUT, 'classes'), '.class')]);
  run('jar', ['--update', '--no-manifest', '--file', unsigned, '-C', path.join(OUT, 'dex'), 'classes.dex']);

  log('zipalign + sign');
  run(sdk.zipalign, ['-f', '4', unsigned, aligned]);
  const ks = keystore(env);
  fs.mkdirSync(DIST, { recursive: true });
  const apk = path.join(DIST, 'promptgate-video.apk');
  // Passwords go through the environment, never the command line.
  run('java', ['-jar', sdk.apksigner, 'sign', '--ks', ks.file, '--ks-key-alias', ks.alias, '--ks-pass', 'env:PGV_KS_PASS', '--key-pass', 'env:PGV_KEY_PASS', '--out', apk, aligned],
    { env: { ...env, PGV_KS_PASS: ks.own ? env.PGV_KS_PASS : 'android', PGV_KEY_PASS: ks.own ? env.PGV_KEY_PASS || env.PGV_KS_PASS : 'android' } });
  fs.rmSync(apk + '.idsig', { force: true });

  const verify = run('java', ['-jar', sdk.apksigner, 'verify', '--verbose', '--min-sdk-version', String(MIN_SDK), apk]);
  const badging = run(sdk.aapt2, ['dump', 'badging', apk]);
  if (!badging.includes(`package: name='${APP_ID}'`)) throw new Error('APK has the wrong package id:\n' + badging.split('\n')[0]);
  if (/uses-permission/.test(badging)) throw new Error('APK must not request permissions:\n' + badging.split('\n').filter((l) => /uses-permission/.test(l)).join('\n'));
  log(`OK ${path.relative(APP, apk)} (${(fs.statSync(apk).size / 1024).toFixed(0)} KB, ${ks.own ? 'your key' : 'debug key'})`);
  return { apk, verify, badging, ownKey: ks.own };
}

if (require.main === module) {
  try { build(); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { build, stage, findSdk, WEB_FILES, ICONS, APP_ID, MIN_SDK, TARGET_SDK, VERSION };
