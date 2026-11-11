'use strict';
// PromptGate Video tests: core logic (storyboard, per-tool prompts, timeline, validation), the
// localhost server, APK staging, and (when Playwright is installed) a real render in headless
// Chromium that must produce a playable video file.
// Run directly: node tests/video.js (from the app folder).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const VID = path.resolve(__dirname, '..'); // the app's own folder: nothing outside it is needed
const V = require(path.join(VID, 'src', 'core.js'));
const { createServer } = require(path.join(VID, 'server.js'));
const apk = require(path.join(VID, 'android', 'build.js'));
const I = require(path.join(VID, 'src', 'i18n.js'));
const A = require(path.join(VID, 'assistant.js'));

let pass = 0, fail = 0, skip = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
function get(port, p, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET', headers: headers || {} }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

(async () => {
  console.log('storyboard');
  const brief = 'Bình minh trên biển Vũng Tàu, sóng nhẹ. Lễ tân mỉm cười chào khách!\n- Căn suite hướng biển\n2) Bữa sáng bên hồ bơi\nCảnh 5: Logo khách sạn';
  const parts = V.splitBrief(brief);
  check('splits on sentences and lines, strips bullets and "Cảnh n:"', parts.length === 5 && parts[2] === 'Căn suite hướng biển' && parts[3] === 'Bữa sáng bên hồ bơi' && parts[4] === 'Logo khách sạn', JSON.stringify(parts));
  const p = V.buildStoryboard({ brief, totalSeconds: 30, aspect: '16:9', style: 'hospitality' });
  check('one scene per part, total matches request', p.scenes.length === 5 && V.totalDuration(p) === 30, String(V.totalDuration(p)));
  check('durations are half-second steps, at least 2 s', p.scenes.every((s) => s.duration >= 2 && s.duration * 2 === Math.round(s.duration * 2)));
  check('longer text gets more time', p.scenes[0].duration > p.scenes[4].duration);
  check('shots and camera moves vary', new Set(p.scenes.map((s) => s.shot)).size >= 3 && new Set(p.scenes.map((s) => s.motion)).size >= 3);
  check('scene ids are unique', new Set(p.scenes.map((s) => s.id)).size === 5);
  check('empty brief gives no scenes', V.buildStoryboard({ brief: '  \n ' }).scenes.length === 0);
  const many = V.buildStoryboard({ brief: Array.from({ length: 40 }, (_, i) => `Shot number ${i}.`).join(' '), maxScenes: 6, totalSeconds: 5 });
  check('too many sentences are merged, total raised to fit the minimum', many.scenes.length === 6 && V.totalDuration(many) === 12, many.scenes.length + '/' + V.totalDuration(many));
  check('distribute never loops on impossible totals', sum(V.distribute(['a', 'b'], 100000, 2)) === 120);
  check('long caption is cut at a word with an ellipsis', V.caption('word '.repeat(60)).length <= 90 && V.caption('word '.repeat(60)).endsWith('…'));

  console.log('validation');
  const bad = V.normalizeProject({ title: 5, aspect: '4:3', style: 'nope', scenes: [null, { text: '  a   b ', duration: 'x', shot: 'zzz' }, { id: '<script>', duration: 9999 }, { id: 'same' }, { id: 'same' }] });
  check('bad fields fall back to safe defaults', bad.aspect === '9:16' && bad.style === 'cinematic' && bad.scenes[1].text === 'a b' && bad.scenes[1].duration === 4 && bad.scenes[1].shot === 'medium');
  check('unsafe id replaced, duration clamped, duplicate ids fixed', /^[\w-]+$/.test(bad.scenes[2].id) && bad.scenes[2].duration === V.LIMITS.sceneMax && bad.scenes[3].id !== bad.scenes[4].id);
  check('garbage input still yields a project', V.normalizeProject('x').scenes.length === 0 && V.normalizeProject(null).title === 'Video mới');
  check('scene count is capped', V.normalizeProject({ scenes: Array.from({ length: 99 }, () => ({})) }).scenes.length === V.LIMITS.scenes);
  check('normalising twice changes nothing', JSON.stringify(V.normalizeProject(p)) === JSON.stringify(p));

  console.log('tool profiles + prompts');
  const want = ['veo', 'runway', 'kling', 'heygen', 'synthesia', 'invideo', 'capcut', 'canva', 'sora', 'pika', 'luma'];
  check('all 11 requested tools are present', V.TOOLS.map((t) => t.id).join() === want.join(), V.TOOLS.map((t) => t.id).join());
  check('every profile has name, category, aspects, tips and an https source', V.TOOLS.every((t) => t.name && ['generative', 'avatar', 'editor'].includes(t.category) && t.aspects.length && /^https:\/\//.test(t.url)));
  check('every profile has inputs and two tips in both languages', V.TOOLS.every((t) => ['vi', 'en'].every((l) => t.inputs[l] && t.tips[l].length === 2)));
  check('generative tools define clip lengths and an element order', V.TOOLS.filter((t) => t.category === 'generative').every((t) => (t.clips || t.range) && t.order.includes('subject')));
  for (const id of want) {
    const pack = V.buildPack(id, p);
    const t = pack.tool;
    const n = t.category === 'editor' ? 1 : 5;
    check(`${id}: ${n} prompt(s), all scene text carried`, pack.items.length === n && p.scenes.every((s) => V.packText(pack).includes(s.text.replace(/[.!]$/, ''))), String(pack.items.length));
  }
  const veo = V.buildPack('veo', p);
  check('veo: camera first, audio line present', /^Wide establishing shot, slow push-in\./.test(veo.items[0].text) && /Audio: /.test(veo.items[0].text));
  check('veo: an 8.5 s+ scene is split across generations and warned', veo.items.some((it) => it.count > 1) === p.scenes.some((s) => s.duration > 8) && (!p.scenes.some((s) => s.duration > 8) || veo.warnings.some((w) => /nhiều clip/.test(w))));
  check('luma/pika: no audio line, warned about missing sound', !/Audio: /.test(V.packText(V.buildPack('luma', p))) && V.buildPack('pika', p).warnings.some((w) => /không tạo âm thanh/.test(w)));
  const tall = { ...p, aspect: '9:16' };
  check('canva: 9:16 unsupported → nearest aspect + warning', V.buildPack('canva', tall).aspect === '16:9' && V.buildPack('canva', tall).warnings.some((w) => /9:16/.test(w)));
  check('nearest aspect for 1:1 on a 16:9 / 9:16 tool is one of them', ['16:9', '9:16'].includes(V.nearestAspect(V.tool('veo'), '1:1')));
  check('sora is flagged as discontinued', V.tool('sora').discontinued === true && V.buildPack('sora', p).warnings.some((w) => /ngừng/.test(w)));
  check('fitClip: list, range, overflow', JSON.stringify([V.fitClip(V.tool('veo'), 5), V.fitClip(V.tool('veo'), 20), V.fitClip(V.tool('kling'), 2), V.fitClip(V.tool('kling'), 45)]) === JSON.stringify([{ seconds: 6, count: 1 }, { seconds: 8, count: 3 }, { seconds: 3, count: 1 }, { seconds: 30, count: 2 }]));
  check('consistency note is added to every generative prompt', V.buildPack('kling', { ...p, consistency: 'same red car' }).items.every((it) => it.text.includes('same red car')));
  check('capcut follows direction → actions → final state → format', /^Scene direction:[\s\S]*Actions in order:[\s\S]*Final state:[\s\S]*Format: 16:9/.test(V.buildPack('capcut', p).items[0].text));
  check('heygen: script per scene', V.buildPack('heygen', p).items.every((it) => /^Scene \d+\nScript: /.test(it.text)));
  check('empty project gives no prompts and does not throw', want.every((id) => V.buildPack(id, {}).items.length === 0));
  const enPack = V.buildPack('canva', tall, 'en');
  check('English packs: labels and warnings in English, prompt text unchanged', /^Scene 1 · /.test(enPack.items[0].label) && enPack.warnings.some((w) => /does not support 9:16/.test(w)) && !/[ạảãàáâăđêôơư]/i.test(enPack.warnings.join('') + enPack.items.map((it) => it.label).join('')) && enPack.items[0].text === V.buildPack('canva', tall).items[0].text);
  check('every style, shot, move and transition has a label in both languages', [V.STYLES, V.SHOTS, V.MOTIONS, V.TRANSITIONS, V.LOOKS, V.FITS, V.CAP_POS, V.CAP_SIZE, V.CAP_BG, V.CAP_ANIM, V.LOGO_POS].every((m) => Object.values(m).every((e) => V.label(e, 'vi') && V.label(e, 'en') && V.label(e, 'en') !== V.label(e, 'vi'))));
  let threw = false; try { V.buildPack('nope', p); } catch (_) { threw = true; }
  check('unknown tool id throws', threw);

  console.log('timeline + renderer maths');
  const tp = V.normalizeProject({ scenes: [{ text: 'a', duration: 2 }, { text: 'b', duration: 3, transition: 'cut' }] });
  check('sceneAt picks the right scene at boundaries', V.sceneAt(tp, 0).index === 0 && V.sceneAt(tp, 1.99).index === 0 && V.sceneAt(tp, 2).index === 1 && V.sceneAt(tp, 99).index === 1 && V.sceneAt(tp, -5).index === 0);
  check('first scene enters from black, then is fully on; a cut has no transition', V.sceneAt(tp, 0).trans.type === 'fade' && V.sceneAt(tp, 0).trans.p === 0 && V.sceneAt(tp, 1).trans === null && V.sceneAt(tp, 2).trans === null);
  check('closing fade: visible until the last half second, black at the end; off when disabled', V.sceneAt(tp, 4).out === 1 && V.sceneAt(tp, 4.75).out === 0.5 && V.sceneAt(tp, 5).out === 0 && V.sceneAt({ ...tp, endFade: false }, 5).out === 1);

  console.log('editing');
  const ed = V.normalizeProject({ scenes: [{ text: 'a', duration: 4 }, { text: 'b', duration: 1, transition: 'slide-left', transDur: 2 }, { text: 'c', duration: 3, transition: 'wipe', transDur: 1 }] });
  const mid = V.sceneAt(ed, 4.25);
  check('transition names the outgoing scene and is capped at half the scene', mid.trans.type === 'slide-left' && mid.trans.prev === 0 && mid.trans.p === 0.5 && V.sceneAt(ed, 4.6).trans === null);
  check('transition progress is eased 0 → 1', V.ease(0) === 0 && V.ease(0.5) === 0.5 && V.ease(1) === 1 && V.ease(0.25) < 0.25 && V.sceneAt(ed, 5.5).trans.p === 0.5);
  const old = V.normalizeProject({ version: 1, title: 'old', scenes: [{ id: 'a1', text: 'x', duration: 3.5, transition: 'fade', shot: 'wide', motion: 'static' }] });
  check('projects saved by the first version open with safe defaults', old.scenes[0].transition === 'fade' && old.scenes[0].speed === 1 && old.scenes[0].volume === 1 && old.scenes[0].trimOut === 0 && old.scenes[0].look === 'none' && old.caption.pos === 'bottom' && old.music.duck === true && old.endFade === true);
  const wild = V.normalizeProject({ caption: { pos: 'x', color: 'red', size: 7 }, music: { volume: 9, fadeIn: -3 }, logo: { size: 900, opacity: 0 }, scenes: [{ speed: 99, volume: -1, trimIn: 5, trimOut: 2, brightness: 999, look: 'constructor', fit: 'toString', transDur: 50 }] });
  check('bad editing values are clamped (incl. prototype keys as names)', wild.caption.pos === 'bottom' && wild.caption.color === '#ffffff' && wild.caption.size === 'm' && wild.music.volume === 1 && wild.music.fadeIn === 0 && wild.logo.size === 40 && wild.logo.opacity === 0.1
    && wild.scenes[0].speed === 4 && wild.scenes[0].volume === 0 && wild.scenes[0].trimOut === 0 && wild.scenes[0].brightness === 150 && wild.scenes[0].look === 'none' && wild.scenes[0].fit === 'cover' && wild.scenes[0].transDur === 2);
  const clip = (o) => ({ trimIn: 0, trimOut: 0, speed: 1, ...o });
  check('clipTime: trim start, speed, loop inside the trim', V.clipTime(clip({ trimIn: 1, trimOut: 3, speed: 2 }), 0.5, 10) === 2 && V.clipTime(clip({ trimIn: 1, trimOut: 3 }), 2.5, 10) === 1.5 && V.clipTime(clip({}), 5, 4) === 1);
  check('clipTime: the exact end holds the last frame instead of wrapping', Math.abs(V.clipTime(clip({ trimIn: 1, trimOut: 3 }), 2, 10) - 2.96) < 1e-9);
  check('clipTime: trim beyond the clip, unknown length and zero span are safe', V.clipTime(clip({ trimIn: 50, trimOut: 60 }), 1, 4) <= 4 && V.clipTime(clip({ trimIn: 2 }), 1, NaN) === 3 && Number.isFinite(V.clipTime(clip({}), 3, 0)));
  check('clipLength plays the trimmed clip once at its speed', V.clipLength(clip({ trimIn: 1, trimOut: 5, speed: 2 }), 10) === 2 && V.clipLength(clip({}), 0.1) === V.LIMITS.sceneMin && V.clipLength(clip({}), 9999) === V.LIMITS.sceneMax);
  const sp = V.splitScene(ed, 0, 1.5, true);
  check('split: two scenes, durations add up, clip continues where it was cut', sp.project.scenes.length === 4 && sp.project.scenes[0].duration === 1.5 && sp.project.scenes[1].duration === 2.5 && sp.project.scenes[0].trimOut === 1.5 && sp.project.scenes[1].trimIn === 1.5 && sp.project.scenes[1].transition === 'cut' && sp.project.scenes[1].id === sp.id && sp.id !== sp.project.scenes[0].id);
  check('split: total time unchanged, original project untouched', V.totalDuration(sp.project) === V.totalDuration(ed) && ed.scenes.length === 3);
  check('split: refuses a cut too close to an edge or out of range', V.splitScene(ed, 0, 0.2, true) === null && V.splitScene(ed, 0, 3.8, true) === null && V.splitScene(ed, 9, 1, true) === null);
  const spFast = V.splitScene(V.normalizeProject({ scenes: [{ duration: 4, speed: 2, trimIn: 1 }] }), 0, 1, true);
  check('split: honours speed and existing trim; images get no trim', spFast.project.scenes[1].trimIn === 3 && V.splitScene(ed, 0, 2, false).project.scenes[1].trimIn === 0);
  const dup = V.duplicateScene(ed, 1);
  check('duplicate: copy sits after the original with a new id', dup.project.scenes.length === 4 && dup.project.scenes[2].text === 'b' && dup.project.scenes[2].id === dup.id && dup.id !== dup.project.scenes[1].id);
  const full = V.normalizeProject({ scenes: Array.from({ length: V.LIMITS.scenes }, () => ({})) });
  check('split and duplicate stop at the scene limit', V.splitScene(full, 0, 2, false) === null && V.duplicateScene(full, 0) === null);
  check('filterCss: look + sliders, empty when neutral', V.filterCss(ed.scenes[0]) === '' && V.filterCss({ ...ed.scenes[0], look: 'mono', brightness: 120, saturation: 0 }) === 'grayscale(1) contrast(1.1) brightness(1.2) saturate(0)');
  check('every look is a valid filter list', Object.values(V.LOOKS).every((l) => /^((blur|brightness|contrast|grayscale|hue-rotate|saturate|sepia)\([\d.a-z-]+\) ?)*$/.test(l.css)));
  check('fitRect: cover fills, contain letterboxes, both centred', JSON.stringify(V.fitRect(200, 100, 100, 100, 'cover')) === '{"x":-50,"y":0,"w":200,"h":100}' && JSON.stringify(V.fitRect(200, 100, 100, 100, 'contain')) === '{"x":0,"y":25,"w":100,"h":50}');
  const lr = V.logoRect({ pos: 'br', size: 20, opacity: 1 }, 1000, 500, 200, 100);
  check('logoRect: sized by frame width, kept inside the corner margin', lr.w === 200 && lr.h === 100 && lr.x === 780 && lr.y === 380 && V.logoRect({ pos: 'tl', size: 20 }, 1000, 500, 200, 100).x === 20);
  check('captionReveal: fade, rise, typewriter, none', V.captionReveal('fade', 0, 'hello', 4).alpha === 0 && V.captionReveal('fade', 1, 'hello', 4).alpha === 1 && V.captionReveal('rise', 0, 'hello', 4).dy === 1 && V.captionReveal('type', 0.1, 'hello', 4).chars === 3 && V.captionReveal('type', 9, 'hello', 4).chars === 5 && V.captionReveal('none', 0, 'hello', 4).alpha === 1);
  const mp = V.normalizeProject({ music: { volume: 0.8, fadeIn: 2, fadeOut: 2, duck: true }, scenes: [{ duration: 10 }] });
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check('musicGain: fade in, hold, duck under clip sound, fade out', V.musicGain(mp, 0, false) === 0 && near(V.musicGain(mp, 1, false), 0.4) && near(V.musicGain(mp, 5, false), 0.8) && near(V.musicGain(mp, 5, true), 0.24) && near(V.musicGain(mp, 9, false), 0.4) && V.musicGain(mp, 10, false) === 0);
  check('musicGain: ducking and fades can be turned off', near(V.musicGain(V.normalizeProject({ ...mp, music: { volume: 0.8, fadeIn: 0, fadeOut: 0, duck: false } }), 0, true), 0.8));
  check('bitrate: scales with size, fps and level, within sane bounds', V.bitrate(720, 1280, 30, 'high') > V.bitrate(720, 1280, 30, 'medium') && V.bitrate(720, 1280, 60, 'low') > V.bitrate(720, 1280, 30, 'low') && V.bitrate(10, 10, 24, 'low') === 500000 && V.bitrate(9999, 9999, 60, 'high') === 40000000 && V.bitrate(720, 1280, 30, 'nope') === V.bitrate(720, 1280, 30, 'medium'));
  check('sceneAt on an empty project is null', V.sceneAt(V.normalizeProject({}), 1) === null);
  const covers = Object.keys(V.MOTIONS).every((m) => [0, 0.3, 1].every((q) => { const f = V.motionTransform(m, q); return f.scale >= 1 && Math.abs(f.tx) <= (f.scale - 1) / 2 + 1e-9 && Math.abs(f.ty) <= (f.scale - 1) / 2 + 1e-9; }));
  check('camera moves never expose the frame edge', covers);
  check('dims: even numbers, right orientation', JSON.stringify([V.dims('9:16', 720), V.dims('16:9', 1080), V.dims('1:1', 360)]) === JSON.stringify([{ width: 720, height: 1280 }, { width: 1920, height: 1080 }, { width: 360, height: 360 }]));
  const measure = (s) => s.length * 10;
  check('wrapLines wraps, keeps an over-long word, caps lines', JSON.stringify(V.wrapLines('aa bb cc dd', 50, measure)) === '["aa bb","cc dd"]' && V.wrapLines('abcdefghijkl x', 50, measure)[0] === 'abcdefghijkl' && V.wrapLines('a b c d e f g h', 30, measure, 2).length === 2);
  check('pickMime prefers mp4, falls back to webm, survives throwing probes', V.pickMime(() => true).startsWith('video/mp4') && V.pickMime((m) => /webm/.test(m)).startsWith('video/webm') && V.pickMime(() => { throw new Error('x'); }) === '');
  check('SRT has cue numbers and timestamps', V.toSRT(tp).startsWith('1\n00:00:00,000 --> 00:00:02,000\na\n\n2\n00:00:02,000 --> 00:00:05,000\nb'));
  check('file names are ASCII-safe', V.fileName('Bình minh ở Vũng Tàu / Đêm!', 'mp4') === 'Binh-minh-o-Vung-Tau-Dem.mp4' && V.fileName('', 'webm') === 'video.webm');

  console.log('languages');
  const keys = (l) => Object.keys(I.STRINGS[l]).sort().join();
  check('VI and EN dictionaries have the same keys', I.LANGS.join() === 'vi,en' && keys('vi') === keys('en'));
  check('same keys are functions in both, with the same arity', Object.keys(I.STRINGS.vi).every((k) => typeof I.STRINGS.vi[k] === typeof I.STRINGS.en[k] && (typeof I.STRINGS.vi[k] !== 'function' || I.STRINGS.vi[k].length === I.STRINGS.en[k].length)));
  check('translate: plain, with values, unknown key, unknown language', I.translate('en')('tab.export') === 'Export' && I.translate('vi')('scene.n', 3) === 'Cảnh 3' && I.translate('en')('nope') === 'nope' && I.translate('xx')('tab.export') === 'Xuất');
  const usedKeys = [...fs.readFileSync(path.join(VID, 'src', 'app.js'), 'utf8').matchAll(/\bt\('([\w.:]+)'/g)].map((m) => m[1])
    .concat([...fs.readFileSync(path.join(VID, 'src', 'index.html'), 'utf8').matchAll(/data-(?:t|ph)="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...new Set(usedKeys)].filter((k) => !(k in I.STRINGS.vi) && !/\.$/.test(k));
  check(`every key the app uses exists (${new Set(usedKeys).size} keys)`, usedKeys.length > 60 && missing.length === 0, missing.join(', '));
  // render.js rejects with codes; saveFile in app.js throws create / write / save.
  const codes = [...fs.readFileSync(path.join(VID, 'src', 'render.js'), 'utf8').matchAll(/new Error\('(\w+)'\)/g)].map((m) => m[1]).concat(['create', 'write', 'save']);
  check('every error code has a message in both languages', codes.length === 8 && codes.every((c) => 'err.' + c in I.STRINGS.vi && 'err.' + c in I.STRINGS.en), codes.join());
  check('app.js holds no hard-coded Vietnamese outside comments', !fs.readFileSync(path.join(VID, 'src', 'app.js'), 'utf8').split('\n').some((l) => !/^\s*\/\//.test(l) && /[ạảãàáâăđêôơưếệộợữ]/i.test(l)));

  console.log('desktop server');
  const server = createServer({ env: { PGV_NO_CLI: '1' } }); // no credentials: the assistant must stay off
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const home = await get(port, '/');
  check('serves the app at /', home.status === 200 && /text\/html/.test(home.type) && home.body.includes('PromptGate'));
  check('serves scripts with a JS content type', /javascript/.test((await get(port, '/core.js')).type));
  check('path traversal and unknown files are 404', (await get(port, '/../server.js')).status === 404 && (await get(port, '/%2e%2e/%2e%2e/package.json')).status === 404 && (await get(port, '/nope.js')).status === 404);
  check('non-GET methods are refused', (await get(port, '/', 'POST')).status === 404);

  console.log('assistant: edit operations');
  const base = V.normalizeProject({ title: 'T', scenes: [{ id: 'a', text: 'one', duration: 4 }, { id: 'b', text: 'two', duration: 4 }, { id: 'c', text: 'three', duration: 4 }] });
  const r1 = V.applyOps(base, [
    { op: 'update_scene', scene: 2, set: { duration: 1.5, transition: 'wipe', look: 'film', id: 'hack', evil: 1 } },
    { op: 'move_scene', scene: 3, to: 1 },
    { op: 'update_project', set: { aspect: '16:9', caption: { pos: 'top', nope: 1 }, music: { volume: 0.2 }, scenes: [] } },
    { op: 'add_scene', after: 0, set: { text: 'intro', duration: 2 } },
  ]);
  check('ops: update, move, project settings and add apply in order', r1.applied === 4 && r1.skipped.length === 0 && r1.project.scenes.map((x) => x.text).join() === 'intro,three,one,two' && r1.project.scenes[3].duration === 1.5 && r1.project.scenes[3].transition === 'wipe' && r1.project.aspect === '16:9' && r1.project.caption.pos === 'top' && r1.project.music.volume === 0.2);
  check('ops: only whitelisted fields are copied (ids, unknown keys and the scene list are untouchable)', r1.project.scenes[3].id === 'b' && !('evil' in r1.project.scenes[3]) && !('nope' in r1.project.caption) && r1.project.scenes.length === 4);
  check('ops: the input project is not modified', base.scenes.length === 3 && base.scenes[1].duration === 4);
  const r2 = V.applyOps(base, [{ op: 'delete_scene', scene: 9 }, { op: 'rm -rf /' }, { op: 'update_scene', scene: 1, set: {} }, { op: 'split_scene', scene: 1, at: 0.1 }, null, 'x', { op: 'update_scene', scene: 1, set: { duration: 9999, look: 'constructor', speed: 'fast' } }]);
  check('ops: bad scene numbers, unknown ops, empty and junk entries are skipped, not fatal', r2.applied === 1 && r2.skipped.map((x) => x.reason).join() === 'scene,unknown,nothing,split,unknown,unknown');
  check('ops: out-of-range values are clamped by the project rules', r2.project.scenes[0].duration === V.LIMITS.sceneMax && r2.project.scenes[0].look === 'none' && r2.project.scenes[0].speed === 1);
  const r3 = V.applyOps(base, [{ op: 'split_scene', scene: 1, at: 1.5 }, { op: 'duplicate_scene', scene: 3 }, { op: 'delete_scene', scene: 4 }], (id) => id === 'a');
  check('ops: split and duplicate report media copies; a copy deleted later is dropped', r3.project.scenes.length === 4 && r3.copies.length === 1 && r3.copies[0].from === 'a' && r3.project.scenes[1].trimIn === 1.5);
  const r4 = V.applyOps(base, [{ op: 'update_scene', scene: 1, set: { text: 'A brand new description' } }, { op: 'update_scene', scene: 2, set: { text: 'changed', caption: 'kept' } }]);
  check('ops: a new description refreshes an untouched caption, an explicit caption wins', r4.project.scenes[0].caption === 'A brand new description' && r4.project.scenes[1].caption === 'kept');
  const styled = V.applyOps({ ...base, caption: { pos: 'top', size: 'l' } }, [{ op: 'update_project', set: { captionStyle: { pos: 'middle', size: 'huge' }, style: 'nope', aspect: '4:3' } }, { op: 'update_scene', scene: 1, set: { look: 'sepia-ish', transition: 'wipe' } }, { op: 'update_scene', scene: 2, set: { fit: 'stretch' } }]);
  check('ops: captionStyle sets the caption look; unknown names keep the current setting', styled.project.caption.pos === 'middle' && styled.project.caption.size === 'l' && styled.project.style === base.style && styled.project.aspect === base.aspect && styled.project.scenes[0].look === 'none' && styled.project.scenes[0].transition === 'wipe' && styled.skipped.length === 1 && styled.skipped[0].reason === 'nothing');
  check('ops: at most MAX_OPS run; non-array input is a no-op', V.applyOps(base, Array.from({ length: 80 }, () => ({ op: 'update_scene', scene: 1, set: { duration: 2 } }))).applied === V.MAX_OPS && V.applyOps(base, 'nope').applied === 0 && V.applyOps(base, null).project.scenes.length === 3);
  const pollute = V.applyOps(base, [JSON.parse('{"op":"update_project","set":{"__proto__":{"polluted":true},"caption":{"__proto__":{"polluted":true}}}}')]);
  check('ops: prototype keys cannot pollute objects', ({}).polluted === undefined && pollute.project.polluted === undefined);

  console.log('assistant: request and response');
  const msgs = A.buildMessages([{ role: 'assistant', text: 'stray' }, { role: 'user', text: 'first' }, { role: 'assistant', text: 'done' }, { role: 'user', text: ' shorten scene 2 ' }], base, { b: { type: 'video', seconds: 7.26 } });
  check('messages: start with the user, only the newest turn carries the project', msgs.length === 3 && msgs[0].content === 'first' && msgs[2].content.startsWith('Current project:') && msgs[2].content.endsWith('Request: shorten scene 2'));
  const described = JSON.parse(msgs[2].content.slice('Current project:\n'.length, msgs[2].content.indexOf('\n\nRequest:')));
  check('messages: scenes are numbered, ids hidden, clip fields only on video scenes', described.scenes[1].scene === 2 && described.scenes[1].media === 'video' && described.scenes[1].clipSeconds === 7.3 && described.scenes[0].media === 'none' && !('speed' in described.scenes[0]) && !JSON.stringify(described).includes('"id"'));
  check('messages: nothing to send without a final user turn; history is capped', A.buildMessages([{ role: 'assistant', text: 'x' }], base) === null && A.buildMessages([], base) === null && A.buildMessages(Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i })).concat([{ role: 'user', text: 'last' }]), base).length <= A.MAX_TURNS);
  const body = A.buildBody(msgs, A.DEFAULT_MODEL);
  check('request: default model, explicit effort, one tool, refusal fallback on', body.model === 'claude-opus-5-5' && body.output_config.effort === 'medium' && body.tools.length === 1 && body.tools[0].name === 'edit_project' && body.fallbacks === 'default' && body.max_tokens >= 4000);
  check('request: no forced tool choice, no sampling or thinking overrides (rejected by current models)', !('tool_choice' in body) && !('temperature' in body) && !('top_p' in body) && !('thinking' in body));
  check('request: fallback parameter only for models that accept it', !('fallbacks' in A.buildBody(msgs, 'claude-haiku-5-5')));
  const opSchema = A.TOOL.input_schema.properties.ops.items.properties;
  check('tool schema offers every editable field and only known enum values', V.SCENE_FIELDS.concat(V.PROJECT_FIELDS, ['captionStyle', 'music', 'logo']).every((k) => k in opSchema.set.properties) && opSchema.set.properties.caption.type === 'string' && opSchema.set.properties.captionStyle.properties.pos.enum.join() === 'bottom,middle,top' && opSchema.set.properties.transition.enum.join() === Object.keys(V.TRANSITIONS).join() && opSchema.op.enum.length === 7);
  const good = A.readResponse({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Đã rút cảnh 2.' }, { type: 'tool_use', name: 'edit_project', input: { ops: [{ op: 'update_scene', scene: 2, set: { duration: 3 } }] } }, { type: 'tool_use', name: 'other', input: { ops: [{ op: 'delete_scene', scene: 1 }] } }] });
  check('response: text becomes the reply, only edit_project calls become ops', good.reply === 'Đã rút cảnh 2.' && good.ops.length === 1 && good.ops[0].set.duration === 3);
  check('response: refusal, truncation and malformed bodies are errors', A.readResponse({ stop_reason: 'refusal', content: [] }).error === 'refused' && A.readResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'x' }] }).error === 'tooLong' && A.readResponse(null).error === 'upstream' && A.readResponse({ content: 'x' }).error === 'upstream');
  check('response: a plain answer has no ops', JSON.stringify(A.readResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] })) === '{"reply":"hi","ops":[]}');
  check('CLI reply: JSON object (even inside a code fence), plain text, empty', A.parseCliReply('```json\n{"reply":"ok","ops":[{"op":"delete_scene","scene":1}]}\n```').ops.length === 1 && A.parseCliReply('just words').reply === 'just words' && A.parseCliReply('just words').ops.length === 0 && A.parseCliReply('').error === 'upstream' && A.parseCliReply('{broken').reply === '{broken');

  console.log('assistant: local server endpoints');
  const seen = [];
  let script = () => ({ status: 200, body: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', name: 'edit_project', input: { ops: [{ op: 'update_scene', scene: 1, set: { duration: 2, look: 'warm' } }, { op: 'update_project', set: { captionStyle: { pos: 'top' } } }] } }] } });
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { seen.push({ headers: req.headers, body: JSON.parse(raw || '{}') }); const out = script(); res.writeHead(out.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out.body)); });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const ai = createServer({ env: { ANTHROPIC_API_KEY: 'test-key-123', PGV_ANTHROPIC_URL: `http://127.0.0.1:${upstream.address().port}/v1/messages`, PGV_NO_CLI: '1' } });
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const aiPort = ai.address().port;
  const JSONH = { 'Content-Type': 'application/json' };
  const askBody = JSON.stringify({ project: base, messages: [{ role: 'user', text: 'make scene 1 shorter and warmer' }] });
  const off = await get(port, '/api/status');
  check('status without credentials: local, assistant off', off.status === 200 && JSON.parse(off.body).local === true && JSON.parse(off.body).assistant === null);
  check('assistant without credentials answers 503, never calls out', (await get(port, '/api/assistant', 'POST', JSONH, askBody)).status === 503 && seen.length === 0);
  const on = JSON.parse((await get(aiPort, '/api/status')).body);
  check('status with a key: API mode and model, the key itself is never returned', on.assistant === 'api' && on.model === 'claude-opus-5-5' && !JSON.stringify(on).includes('test-key'));
  const ok = await get(aiPort, '/api/assistant', 'POST', JSONH, askBody);
  const okBody = JSON.parse(ok.body);
  check('assistant: reply and ops come back to the page', ok.status === 200 && okBody.reply === 'Done.' && okBody.ops.length === 2 && !ok.body.includes('test-key'));
  const sent = seen[0] || { headers: {}, body: {} };
  check('assistant: upstream call carries the key, API version and fallback beta in headers only', sent.headers['x-api-key'] === 'test-key-123' && sent.headers['anthropic-version'] === A.API_VERSION && sent.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && !JSON.stringify(sent.body).includes('test-key'));
  check('assistant: upstream body has the system prompt, tool and project', sent.body.system === A.SYSTEM && sent.body.tools[0].name === 'edit_project' && sent.body.messages[0].content.includes('"scene":1') && sent.body.messages[0].content.endsWith('make scene 1 shorter and warmer'));
  const hdr = (h) => get(aiPort, '/api/assistant', 'POST', h, askBody).then((x) => x.status);
  check('assistant: other sites are refused (foreign Origin, foreign Host, non-JSON body)', (await hdr({ ...JSONH, Origin: 'https://evil.example' })) === 403 && (await hdr({ ...JSONH, Host: 'evil.example' })) === 403 && (await hdr({ 'Content-Type': 'text/plain' })) === 415 && (await hdr({ ...JSONH, Origin: `http://127.0.0.1:${aiPort}` })) === 200);
  check('assistant: status is refused for a foreign Host too (DNS rebinding)', (await get(aiPort, '/api/status', 'GET', { Host: 'evil.example:80' })).status === 403);
  const before = seen.length;
  check('assistant: bad JSON, oversized bodies and wrong methods never reach Claude', (await get(aiPort, '/api/assistant', 'POST', JSONH, '{nope')).status === 400 && (await get(aiPort, '/api/assistant', 'POST', JSONH, JSON.stringify({ messages: [] }))).status === 400
    && (await get(aiPort, '/api/assistant', 'POST', JSONH, JSON.stringify({ pad: 'x'.repeat(600000) })).then((x) => x.status, () => 400)) === 400 && (await get(aiPort, '/api/assistant', 'GET')).status === 405 && (await get(aiPort, '/api/status', 'POST', JSONH, '{}')).status === 405 && seen.length === before);
  const errCode = async (status, bodyOut) => { script = () => ({ status, body: bodyOut || {} }); const x = await get(aiPort, '/api/assistant', 'POST', JSONH, askBody); return x.status + ':' + JSON.parse(x.body).error; };
  check('assistant: upstream failures map to short codes', (await errCode(401)) === '502:auth' && (await errCode(429)) === '502:rate' && (await errCode(529)) === '502:upstream' && (await errCode(400)) === '400:badRequest' && (await errCode(200, { stop_reason: 'refusal', content: [] })) === '502:refused');
  check('every assistant error code has a message in both languages', ['noAssistant', 'auth', 'rate', 'refused', 'timeout', 'network', 'tooLong', 'cli', 'badRequest', 'upstream', 'forbidden', 'server'].every((c) => 'asst.err.' + c in I.STRINGS.vi && 'asst.err.' + c in I.STRINGS.en));
  script = () => ({ status: 200, body: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Xong: cảnh 1 còn 2 giây, chữ lên trên.' }, { type: 'tool_use', name: 'edit_project', input: { ops: [{ op: 'update_scene', scene: 1, set: { duration: 2, look: 'warm' } }, { op: 'update_project', set: { captionStyle: { pos: 'top' } } }, { op: 'delete_scene', scene: 99 }] } }] } });

  console.log('app packaging');
  const html = fs.readFileSync(path.join(VID, 'src', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  check('index.html only loads local files that exist (works offline)', refs.length >= 4 && refs.every((r) => !/^(https?:)?\/\//.test(r) && fs.existsSync(path.join(VID, 'src', r))), refs.join(','));
  check('every loaded file is bundled into the APK', refs.every((r) => apk.WEB_FILES.includes(r)) && apk.WEB_FILES.includes('index.html'));
  const appJs = fs.readFileSync(path.join(VID, 'src', 'app.js'), 'utf8') + fs.readFileSync(path.join(VID, 'src', 'render.js'), 'utf8');
  const fetches = appJs.match(/fetch\([^)]{0,40}/g) || [];
  check('app never uses innerHTML; its only network call is to its own /api/', !/innerHTML|XMLHttpRequest|WebSocket|https?:\/\//.test(appJs.replace(/^\s*\/\/.*$/gm, '')) && fetches.length === 1 && fetches[0].startsWith("fetch('/api/' + path"), fetches.join(' | '));
  const manifest = fs.readFileSync(path.join(VID, 'android', 'AndroidManifest.xml'), 'utf8');
  check('Android manifest requests no permissions', !/uses-permission/.test(manifest) && manifest.includes(`package="${apk.APP_ID}"`));
  const java = fs.readFileSync(path.join(VID, 'android', 'src', 'com', 'promptgate', 'video', 'MainActivity.java'), 'utf8');
  check('Activity package matches the app id and exposes the bridge the app calls', java.includes(`package ${apk.APP_ID};`) && ['beginSave', 'appendSave', 'endSave', 'copy'].every((m) => new RegExp(`public (synchronized )?\\w+ ${m}\\(`).test(java) && appJs.includes('android.' + m + '(')));
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pgv-'));
  const st = apk.stage(TMP);
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  check('stage copies the web app into assets/www', apk.WEB_FILES.every((f) => fs.readFileSync(path.join(st.assets, 'www', f)).equals(fs.readFileSync(path.join(VID, 'src', f)))));
  check('stage generates a launcher icon per density', Object.keys(apk.ICONS).every((d) => fs.readFileSync(path.join(st.res, 'mipmap-' + d, 'ic_launcher.png')).subarray(0, 4).equals(PNG_SIG)));
  let sdkErr = '';
  try { apk.findSdk({}); } catch (e) { sdkErr = e.message; }
  check('building without an SDK fails with a clear message', /ANDROID_HOME/.test(sdkErr));
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log('real render (headless Chromium)');
  let pw = null;
  try { pw = require('playwright'); } catch (_) { /* optional */ }
  if (!pw) { skip++; console.log('  skip Playwright not installed'); } else {
    let browser = null;
    try {
      browser = await pw.chromium.launch();
      const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const external = [];
      page.on('request', (r) => { if (!/^(http:\/\/127\.0\.0\.1|blob:|data:)/.test(r.url())) external.push(r.url()); });

      await page.goto(`http://127.0.0.1:${port}/`);
      await page.fill('#brief', 'A sunrise over the beach. A guest opens the curtains. Breakfast by the pool.');
      await page.fill('#total', '12');
      await page.click('#make');
      check('UI: brief → 3 scene cards', (await page.locator('#scenes .card').count()) === 3);
      await page.click('nav [data-tab=prompts]');
      check('UI: 11 tool chips, Veo prompts shown', (await page.locator('#tools button').count()) === 11 && (await page.locator('#prompts .card').count()) === 3);
      await page.click('#tools button:has-text("InVideo")');
      check('UI: editor tool shows one whole-video prompt', (await page.locator('#prompts .card').count()) === 1 && /12-second/.test(await page.locator('#prompts pre').innerText()));
      await page.click('nav [data-tab=export]');
      const lit = await page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 0) n++; return n / (d.length / 4); });
      await page.fill('#seek', '500');
      const mid = await page.evaluate(() => { const c = document.getElementById('preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n / (d.length / 4); });
      check('UI: preview draws a frame (black at t=0 fade-in, picture mid-video)', lit < 0.05 && mid > 0.5, `${lit.toFixed(2)} / ${mid.toFixed(2)}`);
      check('UI: starts in Vietnamese', (await page.innerText('nav [data-tab=export]')) === 'Xuất' && (await page.innerText('#export')) === 'Xuất video' && (await page.getAttribute('html', 'lang')) === 'vi');
      await page.click('#lang [data-lang=en]');
      check('UI: EN button switches every static label', (await page.innerText('nav [data-tab=export]')) === 'Export' && (await page.innerText('#export')) === 'Export video' && (await page.innerText('#play')) === '▶ Preview' && (await page.innerText('label[for=quality]')) === 'Quality' && (await page.getAttribute('html', 'lang')) === 'en');
      const blank = await page.evaluate(() => [...document.querySelectorAll('[data-t]')].filter((e) => !e.textContent.trim() || e.textContent === e.dataset.t).map((e) => e.dataset.t));
      check('UI: no label left blank or showing its key', blank.length === 0, blank.join());
      await page.click('nav [data-tab=prompts]');
      await page.click('#tools button:has-text("Canva")');
      const enText = (await page.innerText('#tool-info')) + (await page.innerText('#warnings')) + (await page.innerText('#prompts h3 >> nth=0'));
      check('UI: tool card, warnings and prompt labels are English', /Native audio: yes/.test(enText) && /does not support 9:16/.test(enText) && /Scene 1/.test(enText) && /Copy/.test(enText), enText.slice(0, 200));
      await page.click('nav [data-tab=scenes]');
      check('UI: scene editor is English, selects keep their values', (await page.innerText('#scenes .card h3 >> nth=0')).startsWith('Scene 1') && (await page.locator('#scenes select >> nth=0').inputValue()) === 'wide' && (await page.locator('#scenes select >> nth=0').locator('option:checked').innerText()) === 'Wide');
      await page.reload();
      check('UI: language choice survives a reload', (await page.innerText('nav [data-tab=export]')) === 'Export' && (await page.inputValue('#style')) === 'cinematic' && (await page.locator('#style option:checked').innerText()) === 'Cinematic');
      await page.click('#lang [data-lang=vi]');
      check('UI: VI button switches back', (await page.innerText('nav [data-tab=export]')) === 'Xuất' && (await page.innerText('#scenes .card h3 >> nth=0')).startsWith('Cảnh 1'));
      check('UI: project survives a reload', (await page.locator('#scenes .card').count()) === 3);

      // --- compositor: probe pixels of each transition, look, framing, caption and logo -----
      const px = await page.evaluate(async () => {
        const V = window.PGVideo, R = window.PGRender;
        const solid = (color, w, h) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL(); });
        const red = await solid('#ff0000', 90, 160), blue = await solid('#0000ff', 90, 160), wide = await solid('#00ff00', 320, 90), white = await solid('#ffffff', 40, 20);
        const c = document.createElement('canvas'); c.width = 90; c.height = 160;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
        const make = (transition, more, proj) => {
          const p = V.normalizeProject({ aspect: '9:16', endFade: false, ...(proj || {}), scenes: [{ id: 'a', duration: 2, transition: 'cut', motion: 'static', caption: '' }, { id: 'b', duration: 2, transition, transDur: 1, motion: 'static', caption: '', ...(more || {}) }] });
          return [p, new Map([['a', { type: 'image', el: red }], ['b', { type: 'image', el: (more && more.wideImg) ? wide : blue }]])];
        };
        const shot = (transition, t, more, proj, opts) => { const [p, m] = make(transition, more, proj); R.drawFrame(ctx, p, t, m, opts || {}); };
        const out = {};
        shot('cut', 2.5); out.cut = at(45, 80);
        shot('dissolve', 2.5); out.dissolve = at(45, 80);
        shot('fade', 2.5); out.fade = at(45, 80);
        shot('wipe', 2.5); out.wipeL = at(10, 80); out.wipeR = at(80, 80);
        shot('slide-left', 2.5); out.slideL = at(10, 80); out.slideR = at(80, 80);
        shot('slide-up', 2.5); out.slideT = at(45, 20); out.slideB = at(45, 140);
        shot('zoom', 2.5); out.zoom = at(45, 80);
        shot('dissolve', 3.5); out.after = at(45, 80);
        shot('cut', 3, { look: 'mono' }); out.mono = at(45, 80);
        shot('cut', 3, { brightness: 50 }); out.dark = at(45, 80);
        shot('cut', 3, { wideImg: true, fit: 'cover' }); out.coverTop = at(45, 5);
        shot('cut', 3, { wideImg: true, fit: 'contain' }); out.containTop = at(45, 5); out.containMid = at(45, 80);
        shot('cut', 3, { caption: 'MMMM' }, { caption: { pos: 'top', bg: 'none', anim: 'none', size: 'l', color: '#ffff00' } }); out.capTop = [0, 1, 2].some((k) => { for (let x = 20; x < 70; x++) for (let y = 8; y < 32; y++) { const q = at(x, y); if (q[0] > 200 && q[1] > 200 && q[2] < 80) return true; } return false; });
        out.capBottomEmpty = (() => { for (let x = 20; x < 70; x += 2) for (let y = 120; y < 150; y += 2) { const q = at(x, y); if (q[0] > 200 && q[1] > 200) return false; } return true; })();
        shot('cut', 3, {}, { logo: { pos: 'tl', size: 40, opacity: 1 } }, { logo: white }); out.logoIn = at(12, 12); out.logoOut = at(80, 150);
        shot('cut', 3, {}, { endFade: true }); out.endMid = at(45, 80);
        shot('cut', 4, {}, { endFade: true }); out.endBlack = at(45, 80);
        return out;
      });
      const is = (q, r, g, b, tol) => Math.abs(q[0] - r) <= (tol || 12) && Math.abs(q[1] - g) <= (tol || 12) && Math.abs(q[2] - b) <= (tol || 12);
      check('render: cut shows only the new scene; after a transition only the new scene', is(px.cut, 0, 0, 255) && is(px.after, 0, 0, 255), JSON.stringify([px.cut, px.after]));
      check('render: dissolve blends both scenes half-way', is(px.dissolve, 128, 0, 128, 16), JSON.stringify(px.dissolve));
      check('render: fade comes from black, not from the old scene', is(px.fade, 0, 0, 128, 16), JSON.stringify(px.fade));
      check('render: wipe reveals the new scene from the left', is(px.wipeL, 0, 0, 255) && is(px.wipeR, 255, 0, 0), JSON.stringify([px.wipeL, px.wipeR]));
      check('render: slide-left pushes the old scene out to the left', is(px.slideL, 255, 0, 0) && is(px.slideR, 0, 0, 255), JSON.stringify([px.slideL, px.slideR]));
      check('render: slide-up pushes the old scene out the top', is(px.slideT, 255, 0, 0) && is(px.slideB, 0, 0, 255), JSON.stringify([px.slideT, px.slideB]));
      check('render: zoom-through cross-fades while the old scene grows', is(px.zoom, 128, 0, 128, 16), JSON.stringify(px.zoom));
      check('render: mono look removes colour, brightness slider darkens', px.mono[0] === px.mono[1] && px.mono[1] === px.mono[2] && is(px.dark, 0, 0, 128, 16), JSON.stringify([px.mono, px.dark]));
      check('render: cover fills the frame; contain keeps the whole picture over a dimmed blur', is(px.coverTop, 0, 255, 0) && is(px.containMid, 0, 255, 0) && px.containTop[1] > 60 && px.containTop[1] < 200, JSON.stringify([px.coverTop, px.containTop, px.containMid]));
      check('render: caption follows position and colour settings', px.capTop === true && px.capBottomEmpty === true);
      check('render: logo sits in its corner only', is(px.logoIn, 255, 255, 255) && is(px.logoOut, 0, 0, 255), JSON.stringify([px.logoIn, px.logoOut]));
      check('render: closing fade reaches black on the last frame', is(px.endMid, 0, 0, 255) && is(px.endBlack, 0, 0, 0), JSON.stringify([px.endMid, px.endBlack]));

      // --- editor: timeline, split, duplicate, undo/redo, advanced scene controls ---------
      await page.click('nav [data-tab=export]');
      const blocks = () => page.locator('#timeline button').count();
      check('editor: timeline shows one block per scene', (await blocks()) === 3);
      await page.click('#timeline button >> nth=1');
      check('editor: tapping a block moves the playhead to that scene', (await page.locator('#timeline button.on').innerText()).startsWith('2') && Number(await page.inputValue('#seek')) > 300);
      await page.click('#split');
      check('editor: splitting at a scene edge is refused with a hint', (await blocks()) === 3 && !(await page.locator('#toast').isHidden()));
      const totalBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')).scenes.reduce((a, s) => a + s.duration, 0));
      await page.fill('#seek', '500');
      await page.click('#split');
      const afterSplit = await page.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')).scenes);
      check('editor: split at the playhead adds a scene and keeps the total length', (await blocks()) === 4 && Math.abs(afterSplit.reduce((a, s) => a + s.duration, 0) - totalBefore) < 0.11 && afterSplit[2].transition === 'cut', String(await blocks()));
      await page.click('#dup');
      check('editor: duplicate adds a block', (await blocks()) === 5);
      await page.click('#undo'); await page.click('#undo');
      check('editor: undo twice restores the three scenes', (await blocks()) === 3);
      await page.click('#redo');
      check('editor: redo brings the split back', (await blocks()) === 4);
      await page.click('#undo');
      await page.locator('details.panel summary').nth(0).click();
      await page.selectOption('#cap-pos', 'top');
      await page.selectOption('#cap-anim', 'type');
      await page.uncheck('#end-fade');
      const proj1 = await page.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')));
      check('editor: text and export panels write into the project', proj1.caption.pos === 'top' && proj1.caption.anim === 'type' && proj1.endFade === false);
      await page.click('#undo');
      check('editor: undo also covers panel settings and refreshes the controls', (await page.isChecked('#end-fade')) === true && (await page.inputValue('#cap-anim')) === 'type');
      await page.click('#edit-scene');
      check('editor: "edit this scene" opens its advanced block', (await page.locator('#scenes details.adv[open]').count()) === 1);
      const card = page.locator('#scenes .card:has(details.adv[open])');
      await card.locator('select').nth(2).selectOption('wipe');
      await page.locator('#scenes .card:has(details.adv[open]) details.adv select').nth(1).selectOption('film');
      const proj2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')).scenes.find((x) => x.look === 'film') || {});
      check('editor: transition and colour look are saved on the scene', proj2.transition === 'wipe' && proj2.look === 'film', JSON.stringify([proj2.transition, proj2.look]));
      check('editor: advanced block stays open after a re-render', (await page.locator('#scenes details.adv[open]').count()) === 1);
      await page.reload();
      check('editor: edits survive a reload', (await page.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')).scenes.filter((x) => x.look === 'film').length)) === 1 && (await page.locator('#scenes .card').count()) === 3);

      const dl = page.waitForEvent('download', { timeout: 60000 });
      await page.goto(`http://127.0.0.1:${port}/?selftest=1`);
      await page.waitForFunction(() => window.PGV_SELFTEST, null, { timeout: 60000 });
      const r = await page.evaluate(() => window.PGV_SELFTEST);
      check('export: finished without error', r.ok === true, r.error);
      const file = await (await dl).path();
      const buf = fs.readFileSync(file);
      const isWebm = buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      const isMp4 = buf.subarray(4, 8).toString('latin1') === 'ftyp';
      check(`export: saved file is a real ${r.mime} container (${buf.length} bytes)`, buf.length === r.bytes && buf.length > 5000 && (isWebm || isMp4));
      check('export: 360p portrait frame size', r.width === 360 && r.height === 640);
      // Decode the exported file again: proves it plays and has the expected picture.
      const played = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const v = document.createElement('video');
        v.muted = true;
        v.src = URL.createObjectURL(new Blob([bytes]));
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode failed')); });
        await v.play();
        await new Promise((res) => setTimeout(res, 1500));
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
        const x = c.getContext('2d'); x.drawImage(v, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
        return { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, lit: n / (d.length / 4) };
      }, buf.toString('base64'));
      check('export: file decodes and plays back with picture', played.w === 360 && played.h === 640 && played.t > 0.5 && played.lit > 0.5, JSON.stringify(played));
      // --- clip editing end to end: trim + speed + music, exported twice ---------------------
      const clipFile = path.join(os.tmpdir(), `pgv-clip-${process.pid}.${isMp4 ? 'mp4' : 'webm'}`);
      const wavFile = path.join(os.tmpdir(), `pgv-tone-${process.pid}.wav`);
      fs.writeFileSync(clipFile, buf);
      const sr = 8000, n = sr * 3, wav = Buffer.alloc(44 + n * 2);
      wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
      for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / sr) * 12000), 44 + i * 2);
      fs.writeFileSync(wavFile, wav);
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.click('nav [data-tab=brief]');
      await page.fill('#brief', 'Lobby at dawn.\nGuest walks to the pool.');
      await page.fill('#total', '4');
      page.once('dialog', (d) => d.accept());
      await page.click('#make');
      await page.locator('#scenes input[type=file]').nth(1).setInputFiles(clipFile);
      await page.waitForSelector('#scenes .media');
      const clipCard = page.locator('#scenes .card').nth(1);
      await clipCard.locator('details.adv summary').click();
      const advNums = clipCard.locator('details.adv input[type=number]');
      await advNums.nth(0).fill('0.5'); await advNums.nth(0).dispatchEvent('change');
      await advNums.nth(1).fill('2.5'); await advNums.nth(1).dispatchEvent('change');
      await clipCard.locator('details.adv select').first().selectOption('2');
      await clipCard.locator('details.adv button').first().click();
      const sc = await page.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')).scenes[1]);
      check('clip: trim and speed saved; "match length" sets the scene to (2.5 − 0.5) ÷ 2 = 1 s', sc.trimIn === 0.5 && sc.trimOut === 2.5 && sc.speed === 2 && sc.duration === 1, JSON.stringify([sc.trimIn, sc.trimOut, sc.speed, sc.duration]));
      await page.click('nav [data-tab=export]');
      await page.locator('details.panel summary').nth(1).click();
      await page.setInputFiles('#music', wavFile);
      await page.waitForFunction(() => document.getElementById('music-name').textContent.includes('.wav'));
      await page.click('#timeline button >> nth=1');
      await page.waitForTimeout(400);
      const seekPos = await page.evaluate(() => [...document.querySelectorAll('video')].length);
      check('clip: scrubbing keeps the clip paused on the page (no stray video elements)', seekPos === 0);
      await page.selectOption('#quality', '360');
      const probe = async (b64) => page.evaluate(async (data) => {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))]));
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode failed')); });
        v.volume = 0.01;
        await v.play().catch(() => { v.muted = true; return v.play(); });
        await new Promise((res) => setTimeout(res, 1200));
        return { w: v.videoWidth, audio: v.webkitAudioDecodedByteCount, t: v.currentTime };
      }, b64);
      for (const round of [1, 2]) {
        const d2 = page.waitForEvent('download', { timeout: 60000 });
        await page.click('#export');
        const f2 = fs.readFileSync(await (await d2).path());
        await page.waitForFunction(() => document.getElementById('progress').hidden);
        const info = await probe(f2.toString('base64'));
        check(`clip: export ${round} plays and carries sound (music + clip routed through one audio graph)`, info.w === 360 && info.t > 0.5 && info.audio > 0, JSON.stringify(info));
      }
      await page.reload();
      await page.click('nav [data-tab=export]'); // before the saved files finish loading
      const restored = await page.waitForFunction(() => document.getElementById('music-name').textContent.includes('.wav') && document.querySelectorAll('#timeline button.has-media').length === 1, null, { timeout: 8000 }).then(() => true, () => false);
      check('clip: music and attached clip come back after a reload, without leaving the chosen tab', restored && !(await page.locator('#tab-export').isHidden()));
      for (const f of [clipFile, wavFile]) fs.rmSync(f, { force: true });

      // --- Local tab + Claude assistant (mock Claude behind the local server) ---------------
      await page.click('nav [data-tab=local]');
      await page.waitForFunction(() => document.getElementById('asst-state').textContent !== '' && !/kiểm tra|checking/.test(document.getElementById('asst-state').textContent));
      check('local: without Claude the chat is disabled and says how to enable it', (await page.isDisabled('#asst-send')) && (await page.isDisabled('#asst-input')) && /ANTHROPIC_API_KEY/.test(await page.innerText('#asst-log')) && /127\.0\.0\.1/.test(await page.innerText('#local-status')) && /npm run video/.test(await page.innerText('#local-cmd')));
      const page2 = await ctx.newPage();
      page2.on('pageerror', (e) => errors.push(e.message));
      page2.on('request', (r2) => { if (!/^(http:\/\/127\.0\.0\.1|blob:|data:)/.test(r2.url())) external.push(r2.url()); });
      await page2.goto(`http://127.0.0.1:${aiPort}/`);
      await page2.fill('#brief', 'Lobby at dawn. Guest walks to the pool. Sunset bar.');
      await page2.fill('#total', '12');
      await page2.click('#make');
      await page2.click('nav [data-tab=local]');
      await page2.waitForFunction(() => /claude-opus-5-5/.test(document.getElementById('asst-state').textContent));
      check('local: with Claude the chat is enabled and shows the model', !(await page2.isDisabled('#asst-send')) && (await page2.locator('#asst-ideas button').count()) === 3);
      const dur0 = await page2.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')).scenes[0].duration);
      const calls = seen.length;
      await page2.fill('#asst-input', 'rút cảnh 1 còn 2 giây, tông ấm, chữ lên trên');
      await page2.click('#asst-send');
      await page2.waitForSelector('#asst-log .assistant');
      const pj = await page2.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')));
      check('chat: Claude\'s edits land in the project', pj.scenes[0].duration === 2 && pj.scenes[0].look === 'warm' && pj.caption.pos === 'top' && pj.scenes.length === 3, JSON.stringify([pj.scenes[0].duration, pj.scenes[0].look, pj.caption.pos]));
      const chatText = await page2.innerText('#asst-log');
      check('chat: shows the request, the reply, what was applied and what was skipped', /rút cảnh 1/.test(chatText) && /Xong: cảnh 1 còn 2 giây/.test(chatText) && /2 thay đổi/.test(chatText) && /Bỏ qua 1/.test(chatText));
      check('chat: one upstream call, carrying the live project and the request', seen.length === calls + 1 && /Lobby at dawn/.test(seen[seen.length - 1].body.messages[0].content) && /rút cảnh 1/.test(seen[seen.length - 1].body.messages[0].content));
      check('chat: header summary reflects the new total', (await page2.innerText('#summary')).includes(V.fmtTime(pj.scenes.reduce((x, y) => x + y.duration, 0))) && pj.scenes.reduce((x, y) => x + y.duration, 0) < 12, await page2.innerText('#summary'));
      await page2.click('#asst-log .assistant button');
      const undone = await page2.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')));
      check('chat: Undo in the reply restores the project in one tap', undone.scenes[0].duration === dur0 && undone.scenes[0].look === 'none' && undone.caption.pos === 'bottom');
      script = () => ({ status: 429, body: {} });
      await page2.fill('#asst-input', 'again');
      await page2.click('#asst-send');
      await page2.waitForFunction(() => document.querySelectorAll('#asst-log .assistant').length === 2);
      check('chat: an upstream error is shown in the user\'s language and changes nothing', /giới hạn tốc độ/.test(await page2.locator('#asst-log .assistant').nth(1).innerText()) && (await page2.evaluate(() => JSON.parse(localStorage.getItem('pgv.project')).scenes[0].duration)) === dur0);
      script = () => ({ status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: '<img src=x onerror=window.__xss=1> ok' }] } });
      await page2.fill('#asst-input', 'hello');
      await page2.click('#asst-send');
      await page2.waitForFunction(() => document.querySelectorAll('#asst-log .assistant').length === 3);
      check('chat: reply text is shown as text, never as HTML; failed turns are not resent', (await page2.evaluate(() => window.__xss)) === undefined && (await page2.locator('#asst-log img').count()) === 0 && seen[seen.length - 1].body.messages.every((m) => !/giới hạn/.test(m.content)) && seen[seen.length - 1].body.messages.filter((m) => m.role === 'user').length === 3);
      await page2.click('#lang [data-lang=en]');
      check('local: tab switches language', (await page2.innerText('#asst-send')) === 'Send to Claude' && /Run locally/.test(await page2.innerText('#tab-local')));
      await page2.close();

      check('no page errors, no request leaves localhost', errors.length === 0 && external.length === 0, errors.concat(external).join(' | '));
    } catch (e) {
      check('browser run completed', false, e.message.split('\n')[0]);
    } finally {
      if (browser) await browser.close();
    }
  }

  server.close(); ai.close(); upstream.close();
  console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
