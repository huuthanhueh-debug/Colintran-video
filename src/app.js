// PromptGate Video UI. Four tabs: brief → scenes → prompts per AI tool → edit & export.
// Runs from a local web server on a computer and inside the Android WebView (window.PGVAndroid).
(function () {
  'use strict';
  const V = window.PGVideo, R = window.PGRender;
  const $ = (id) => document.getElementById(id);
  const android = window.PGVAndroid || null;
  const I = window.PGI18n;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k in el) el[k] = v; else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode or full: keep working in memory */ } },
  };
  let toastTimer = 0;
  function toast(msg) {
    const box = $('toast');
    box.textContent = msg; box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
  }

  // ---- language ------------------------------------------------------------------------
  let lang = store.get('pgv.lang', 'vi');
  if (!I.LANGS.includes(lang)) lang = 'vi';
  let t = I.translate(lang);
  let tab = 'brief';
  // Error objects carry a short code (see render.js); show its translation when there is one.
  const why = (e) => { const m = e && e.message ? e.message : String(e); const tr = t('err.' + m); return tr === 'err.' + m ? m : tr; };

  // ---- state ---------------------------------------------------------------------------
  let project = V.normalizeProject(store.get('pgv.project', null));
  let toolId = store.get('pgv.tool', 'veo');
  if (!V.tool(toolId)) toolId = 'veo';
  const media = new Map(); // sceneId -> { type, el, url, name, blob }
  const extra = { music: null, musicName: '', logo: null, logoName: '' }; // project-wide files
  const MUSIC_KEY = '*music', LOGO_KEY = '*logo'; // '*' cannot appear in a scene id
  const openAdv = new Set(); // scene ids whose "advanced" block is open

  // Undo / redo: every saved change pushes the previous project. Media files are not part of
  // the project, so a deleted scene keeps its file until the app restarts and undo restores it.
  const hist = { undo: [], redo: [], last: JSON.stringify(project) };
  function saveProject() {
    const now = JSON.stringify(project);
    if (now !== hist.last) {
      hist.undo.push(hist.last);
      if (hist.undo.length > 60) hist.undo.shift();
      hist.redo.length = 0;
      hist.last = now;
    }
    store.set('pgv.project', project);
    renderSummary();
  }
  function travel(from, to, emptyKey) {
    if (exporting) return;
    if (!from.length) return toast(t(emptyKey));
    to.push(hist.last);
    hist.last = from.pop();
    project = V.normalizeProject(JSON.parse(hist.last));
    store.set('pgv.project', project);
    refresh();
  }
  // Scene edits go through here so they always land on the live project object.
  function edit(i, key, value) {
    if (!project.scenes[i]) return;
    project.scenes[i][key] = value;
    project = V.normalizeProject(project);
    saveProject();
  }

  // Imported images, clips, music and logo are kept in IndexedDB so they survive closing the app.
  const idb = {
    db: null,
    open() {
      return new Promise((res) => {
        try {
          const rq = indexedDB.open('pgv', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('media');
          rq.onsuccess = () => { idb.db = rq.result; res(); };
          rq.onerror = () => res();
        } catch (_) { res(); }
      });
    },
    tx(mode, fn) {
      return new Promise((res) => {
        if (!idb.db) return res(null);
        try { const rq = fn(idb.db.transaction('media', mode).objectStore('media')); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); }
        catch (_) { res(null); }
      });
    },
    put: (key, blob, name) => idb.tx('readwrite', (s) => s.put({ blob, name }, key)),
    del: (key) => idb.tx('readwrite', (s) => s.delete(key)),
  };
  function attach(sceneId, blob, name) {
    return new Promise((res) => {
      drop(sceneId);
      const type = /^video\//.test(blob.type) ? 'video' : 'image';
      const url = URL.createObjectURL(blob);
      const el = type === 'video' ? h('video', { muted: true, playsInline: true, preload: 'auto' }) : new Image();
      const done = (ok) => { if (ok) media.set(sceneId, { type, el, url, name, blob }); else URL.revokeObjectURL(url); res(ok); };
      el.addEventListener(type === 'video' ? 'loadeddata' : 'load', () => done(true), { once: true });
      el.addEventListener('error', () => done(false), { once: true });
      // A paused clip repaints the preview when a scrub lands on its frame.
      if (type === 'video') el.addEventListener('seeked', () => { if (tab === 'export' && !pv.playing && !exporting) paint(true); });
      el.src = url;
    });
  }
  function drop(sceneId) {
    const m = media.get(sceneId);
    if (m) { if (m.type === 'video') m.el.pause(); URL.revokeObjectURL(m.url); media.delete(sceneId); }
  }
  function loadImage(blob) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = URL.createObjectURL(blob);
    });
  }
  function setMusic(blob, name) {
    if (extra.music) { extra.music.pause(); URL.revokeObjectURL(extra.music.src); }
    extra.music = blob ? h('audio', { src: URL.createObjectURL(blob), preload: 'auto', loop: true }) : null;
    extra.musicName = blob ? name || '' : '';
    $('music-name').textContent = extra.musicName ? '♪ ' + extra.musicName : '';
    $('music-remove').hidden = !extra.music;
  }
  async function setLogo(blob, name) {
    const img = blob ? await loadImage(blob) : null;
    if (extra.logo) URL.revokeObjectURL(extra.logo.src);
    extra.logo = img;
    extra.logoName = img ? name || '' : '';
    $('logo-name').textContent = extra.logoName ? '🖼 ' + extra.logoName : '';
    $('logo-remove').hidden = !img;
    return !!img;
  }

  // ---- saving files ----------------------------------------------------------------------
  function b64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  async function saveFile(name, mime, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    if (android) {
      if (!android.beginSave(name, mime)) throw new Error('create');
      const step = 3 * 256 * 1024; // multiple of 3 so base64 chunks join cleanly
      for (let o = 0; o < blob.size; o += step) {
        if (!android.appendSave(await b64(blob.slice(o, o + step)))) throw new Error('write');
      }
      const where = android.endSave();
      if (!where) throw new Error('save');
      return where;
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return t('downloads', name);
  }
  async function copy(text) {
    try {
      if (android) android.copy(text);
      else if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else { const ta = h('textarea', { value: text }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      toast(t('copied'));
    } catch (_) { toast(t('copy.fail')); }
  }

  // ---- tabs ------------------------------------------------------------------------------
  function show(name) {
    tab = name;
    stopPreview();
    for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== 'tab-' + tab;
    for (const b of $('nav').children) b.classList.toggle('on', b.dataset.tab === tab);
    refresh();
    window.scrollTo(0, 0);
  }
  // Redraws whatever the current tab builds from the project (after edits, undo, language).
  function refresh() {
    renderSummary();
    if (tab === 'scenes') renderScenes();
    if (tab === 'prompts') renderPrompts();
    if (tab === 'export') { syncPanels(); setupPreview(); }
  }
  $('nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); });
  function renderSummary() {
    const n = project.scenes.length;
    $('summary').textContent = n ? t('summary', project.title, n, V.fmtTime(V.totalDuration(project)), project.aspect) : t('summary.empty');
  }
  $('undo').addEventListener('click', () => travel(hist.undo, hist.redo, 'undo.none'));
  $('redo').addEventListener('click', () => travel(hist.redo, hist.undo, 'redo.none'));

  // ---- brief -----------------------------------------------------------------------------
  // Select boxes are rebuilt on a language switch; the chosen value is kept.
  function fillSelect(id, entries) {
    const el = $(id), cur = el.value;
    el.replaceChildren(...entries.map(([value, textContent]) => h('option', { value, textContent })));
    if (cur) el.value = cur;
  }
  const labelled = (map) => Object.entries(map).map(([k, v]) => [k, V.label(v, lang)]);
  function fillSelects() {
    fillSelect('aspect', V.ASPECTS.map((a) => [a, t('aspect.' + a)]));
    fillSelect('style', labelled(V.STYLES));
    fillSelect('quality', [['720', '720p'], ['1080', '1080p'], ['360', t('quality.360')]]);
    fillSelect('fps', [['30', '30'], ['24', '24'], ['60', '60']]);
    fillSelect('bitrate', [['medium', t('bitrate.medium')], ['high', t('bitrate.high')], ['low', t('bitrate.low')]]);
    fillSelect('cap-pos', labelled(V.CAP_POS));
    fillSelect('cap-size', labelled(V.CAP_SIZE));
    fillSelect('cap-bg', labelled(V.CAP_BG));
    fillSelect('cap-anim', labelled(V.CAP_ANIM));
    fillSelect('logo-pos', labelled(V.LOGO_POS));
  }
  fillSelects();
  const briefState = store.get('pgv.brief', {});
  $('brief').value = briefState.brief || '';
  $('consistency').value = briefState.consistency || project.consistency;
  $('aspect').value = briefState.aspect || project.aspect;
  $('style').value = briefState.style || project.style;
  $('total').value = briefState.total || 30;
  const readBrief = () => ({ brief: $('brief').value, consistency: $('consistency').value, aspect: $('aspect').value, style: $('style').value, total: $('total').value });
  for (const id of ['brief', 'consistency', 'aspect', 'style', 'total']) $(id).addEventListener('change', () => store.set('pgv.brief', readBrief()));
  $('make').addEventListener('click', () => {
    const b = readBrief();
    if (!V.splitBrief(b.brief).length) return toast(t('brief.empty'));
    if (project.scenes.length && !confirm(t('brief.replace'))) return;
    const keep = { caption: project.caption, music: project.music, logo: project.logo, endFade: project.endFade };
    project = V.normalizeProject({ ...V.buildStoryboard({ brief: b.brief, consistency: b.consistency, aspect: b.aspect, style: b.style, totalSeconds: b.total }), ...keep });
    store.set('pgv.brief', b);
    saveProject();
    show('scenes');
  });

  // ---- scenes ----------------------------------------------------------------------------
  const options = (map, cur) => Object.entries(map).map(([k, v]) => h('option', { value: k, selected: k === cur, textContent: V.label(v, lang) }));
  const field = (labelKey, control) => h('div', null, h('label', { textContent: t(labelKey) }), control);
  const numInput = (i, key, min, max, step, value, rerender) => h('input', { type: 'number', min, max, step, value, on: { change: (e) => { edit(i, key, Number(e.target.value)); if (rerender) renderScenes(); else e.target.value = project.scenes[i][key]; } } });
  // scale: the project stores value / scale (volume is 0..1 behind a 0..100 slider).
  const range = (i, key, min, max, value, scale) => h('input', { type: 'range', min, max, value, on: { change: (e) => edit(i, key, Number(e.target.value) / (scale || 1)) } });
  async function copyMedia(fromId, toId) {
    const m = media.get(fromId);
    if (!m) return;
    await attach(toId, m.blob, m.name);
    idb.put(toId, m.blob, m.name);
  }
  async function duplicate(i) {
    const r = V.duplicateScene(project, i);
    if (!r) return toast(t('scene.max', V.LIMITS.scenes));
    const fromId = project.scenes[i].id;
    project = r.project;
    await copyMedia(fromId, r.id);
    saveProject();
    refresh();
  }
  function renderScenes() {
    const box = $('scenes');
    box.replaceChildren();
    if (!project.scenes.length) box.append(h('p', { className: 'muted', textContent: t('scene.none') }));
    project.scenes.forEach((s, i) => {
      const m = media.get(s.id);
      const set = (key) => (e) => edit(i, key, e.target.value);
      const move = (d) => () => { const j = i + d; if (j < 0 || j >= project.scenes.length) return; project.scenes.splice(j, 0, project.scenes.splice(i, 1)[0]); saveProject(); renderScenes(); };
      const pick = h('input', { type: 'file', accept: 'image/*,video/*', hidden: true, on: { change: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (!(await attach(s.id, f, f.name))) return toast(t('media.bad'));
        idb.put(s.id, f, f.name);
        renderScenes();
      } } });
      const isVideo = m && m.type === 'video';
      const adv = h('details', { className: 'adv', open: openAdv.has(s.id), on: { toggle: (e) => { if (e.target.open) openAdv.add(s.id); else openAdv.delete(s.id); } } },
        h('summary', { textContent: t('adv') }),
        isVideo && h('p', { className: 'small muted', textContent: t('adv.clip', (Math.round(m.el.duration * 10) / 10) || '?') }),
        isVideo && h('div', { className: 'row' },
          field('trim.in', numInput(i, 'trimIn', 0, 3600, 0.1, s.trimIn)),
          field('trim.out', numInput(i, 'trimOut', 0, 3600, 0.1, s.trimOut)),
          field('speed', h('select', { on: { change: (e) => edit(i, 'speed', Number(e.target.value)) } }, V.SPEEDS.map((v) => h('option', { value: v, selected: v === s.speed, textContent: v + '×' })))),
          field('clip.volume', range(i, 'volume', 0, 100, Math.round(s.volume * 100), 100))),
        isVideo && h('button', { textContent: t('clip.fit'), on: { click: () => { edit(i, 'duration', V.clipLength(project.scenes[i], m.el.duration)); renderScenes(); } } }),
        h('div', { className: 'row' },
          field('fit', h('select', { on: { change: set('fit') } }, options(V.FITS, s.fit))),
          field('look', h('select', { on: { change: set('look') } }, options(V.LOOKS, s.look))),
          field('brightness', range(i, 'brightness', 50, 150, s.brightness)),
          field('contrast', range(i, 'contrast', 50, 150, s.contrast)),
          field('saturation', range(i, 'saturation', 0, 200, s.saturation))),
        h('button', { textContent: t('look.reset'), on: { click: () => { Object.assign(project.scenes[i], { look: 'none', brightness: 100, contrast: 100, saturation: 100 }); saveProject(); renderScenes(); } } }));
      box.append(h('div', { className: 'card', id: 'scene-' + s.id },
        h('h3', null, t('scene.n', i + 1), h('span', null,
          h('button', { textContent: '↑', title: t('scene.up'), disabled: i === 0, on: { click: move(-1) } }), ' ',
          h('button', { textContent: '↓', title: t('scene.down'), disabled: i === project.scenes.length - 1, on: { click: move(1) } }), ' ',
          h('button', { textContent: '⧉', title: t('scene.dup'), on: { click: () => duplicate(i) } }), ' ',
          h('button', { textContent: '✕', title: t('scene.delete'), on: { click: () => { project.scenes.splice(i, 1); saveProject(); renderScenes(); } } }))),
        h('label', { textContent: t('scene.text') }),
        h('textarea', { rows: 2, value: s.text, maxLength: V.LIMITS.text, on: { change: set('text') } }),
        h('label', { textContent: t('scene.caption') }),
        h('input', { type: 'text', value: s.caption, maxLength: 160, on: { change: set('caption') } }),
        h('div', { className: 'row' },
          field('scene.seconds', numInput(i, 'duration', V.LIMITS.sceneMin, V.LIMITS.sceneMax, 0.1, s.duration, true)),
          field('scene.shot', h('select', { on: { change: set('shot') } }, options(V.SHOTS, s.shot))),
          field('scene.motion', h('select', { on: { change: set('motion') } }, options(V.MOTIONS, s.motion))),
          field('scene.transition', h('select', { on: { change: (e) => { edit(i, 'transition', e.target.value); renderScenes(); } } }, options(V.TRANSITIONS, s.transition))),
          s.transition !== 'cut' && field('scene.transDur', numInput(i, 'transDur', 0.2, 2, 0.1, s.transDur))),
        h('div', { className: 'acts' }, pick,
          h('button', { textContent: m ? t('media.change') : t('media.add'), on: { click: () => pick.click() } }),
          m && h('button', { textContent: t('media.remove'), on: { click: () => { drop(s.id); idb.del(s.id); renderScenes(); } } }),
          m && h('span', { className: 'media', textContent: (isVideo ? '🎬 ' : '🖼 ') + (m.name || '') })),
        adv));
    });
  }
  $('add-scene').addEventListener('click', () => {
    if (project.scenes.length >= V.LIMITS.scenes) return toast(t('scene.max', V.LIMITS.scenes));
    project.scenes.push({ text: '', duration: 4 });
    project = V.normalizeProject(project);
    saveProject(); renderScenes();
  });

  // ---- prompts ---------------------------------------------------------------------------
  function renderPrompts() {
    const tool = V.tool(toolId);
    $('tools').replaceChildren(...V.TOOLS.map((x) => h('button', { textContent: x.name, className: x.id === toolId ? 'on' : '', on: { click: () => { toolId = x.id; store.set('pgv.tool', toolId); renderPrompts(); } } })));
    const len = tool.range ? t('len.range', tool.range[0], tool.range[1]) : tool.clips ? t('len.clips', tool.clips.join(' / ')) : t('len.plan');
    $('tool-info').replaceChildren(
      h('h3', null, `${tool.name}${tool.version ? ' · ' + tool.version : ''}`, h('span', { className: 'tag', textContent: t(tool.discontinued ? 'cat.gone' : 'cat.' + tool.category) })),
      h('p', { className: 'small', textContent: t('tool.line', len, tool.aspects.join(', '), t(tool.audio ? 'yes' : 'no'), tool.inputs[lang]) }),
      ...tool.tips[lang].map((tip) => h('p', { className: 'small muted', textContent: '• ' + tip })),
      h('p', { className: 'small' }, h('a', { href: tool.url, target: '_blank', rel: 'noopener', textContent: t('source') }), h('span', { className: 'muted', textContent: t('checked', V.CHECKED) })));
    const pack = V.buildPack(toolId, project, lang);
    $('warnings').replaceChildren(...pack.warnings.map((w) => h('div', { className: 'warn', textContent: w })));
    $('prompts').replaceChildren(...(pack.items.length ? pack.items.map((it) => h('div', { className: 'card' },
      h('h3', null, it.label, h('button', { textContent: t('copy'), on: { click: () => copy(it.text) } })),
      h('pre', { textContent: it.text }))) : [h('p', { className: 'muted', textContent: t('prompts.none') })]));
    $('copy-all').disabled = !pack.items.length;
    $('copy-all').onclick = () => copy(V.packText(pack));
  }

  // ---- preview, timeline, export ---------------------------------------------------------
  const pv = { ctx: null, t: 0, playing: false, timer: 0, last: 0 };
  let exporting = null;
  const drawOpts = (guides) => ({ captions: $('captions').checked, logo: extra.logo, guides });
  const audioOpts = () => ({ clipAudio: $('clip-audio').checked, music: extra.music });
  // fromSeek: a clip just landed on its frame, so draw it without asking for another seek.
  function paint(fromSeek) {
    if (!pv.ctx) return;
    const total = V.totalDuration(project);
    const at = R.drawFrame(pv.ctx, project, pv.t, media, drawOpts($('guides').checked));
    if (!fromSeek) R.syncVideos(project, media, at, pv.playing);
    if (pv.playing) R.mixAudio(project, media, at, pv.t, audioOpts());
    $('seek').value = total ? Math.round((pv.t / total) * 1000) : 0;
    $('clock').textContent = `${V.fmtTime(pv.t)} / ${V.fmtTime(total)}`;
    const blocks = $('timeline').querySelectorAll('button');
    blocks.forEach((b, i) => b.classList.toggle('on', !!at && i === at.index));
    const cur = at && blocks[at.index];
    $('playhead').hidden = !cur;
    if (cur) $('playhead').style.left = (cur.offsetLeft + cur.offsetWidth * at.progress) + 'px';
  }
  function seekTo(time) {
    if (exporting) return;
    stopPreview();
    pv.t = Math.min(Math.max(0, time), V.totalDuration(project));
    paint();
  }
  function renderTimeline() {
    const head = $('playhead');
    $('timeline').replaceChildren(head, ...V.timeline(project).map((x, i) => h('button', {
      className: media.has(x.scene.id) ? 'has-media' : '', style: `flex-grow:${x.scene.duration}`, title: x.scene.caption,
      on: { click: () => seekTo(x.start + 0.001) },
    }, String(i + 1), h('small', { textContent: x.scene.duration + 's' }))));
  }
  function setupPreview() {
    const c = $('preview');
    const d = V.dims(project.aspect, 360);
    c.width = d.width; c.height = d.height;
    pv.ctx = c.getContext('2d');
    pv.t = Math.min(pv.t, V.totalDuration(project));
    renderTimeline();
    paint();
  }
  function stopPreview() {
    pv.playing = false;
    clearInterval(pv.timer);
    R.syncVideos(project, media, null, false);
    R.mixAudio(project, media, null, 0, audioOpts());
    if (extra.music) extra.music.pause();
    $('play').textContent = t('play');
  }
  $('play').addEventListener('click', () => {
    if (exporting) return;
    if (pv.playing) return stopPreview();
    const total = V.totalDuration(project);
    if (!total) return toast(t('scene.none'));
    if (pv.t >= total) pv.t = 0;
    pv.playing = true; pv.last = performance.now();
    $('play').textContent = t('pause');
    R.resumeAudio();
    if (extra.music) {
      try { extra.music.currentTime = extra.music.duration ? pv.t % extra.music.duration : 0; } catch (_) { /* not loaded yet */ }
      extra.music.play().catch(() => {});
    }
    pv.timer = setInterval(() => {
      const now = performance.now();
      pv.t += (now - pv.last) / 1000; pv.last = now;
      if (pv.t >= total) { pv.t = total; stopPreview(); return paint(); }
      paint();
    }, 1000 / 30);
  });
  $('seek').addEventListener('input', () => seekTo(($('seek').value / 1000) * V.totalDuration(project)));
  for (const id of ['captions', 'guides']) $(id).addEventListener('change', () => { if (!exporting) paint(); });

  const current = () => V.sceneAt(project, pv.t);
  $('split').addEventListener('click', async () => {
    const at = current();
    if (!at || exporting) return;
    stopPreview();
    const m = media.get(at.scene.id);
    const r = V.splitScene(project, at.index, at.local, !!m && m.type === 'video');
    if (!r) return toast(project.scenes.length >= V.LIMITS.scenes ? t('scene.max', V.LIMITS.scenes) : t('tl.split.bad'));
    project = r.project;
    await copyMedia(at.scene.id, r.id);
    saveProject();
    refresh();
  });
  $('dup').addEventListener('click', () => { const at = current(); if (at && !exporting) { stopPreview(); duplicate(at.index); } });
  $('edit-scene').addEventListener('click', () => {
    const at = current();
    if (!at) return;
    openAdv.add(at.scene.id);
    show('scenes');
    const card = $('scene-' + at.scene.id);
    if (card) card.scrollIntoView({ block: 'start' });
  });

  // Project-wide panels: every control writes straight into the project (so undo covers it).
  const PANEL = [
    ['cap-pos', (v) => { project.caption.pos = v; }, () => project.caption.pos],
    ['cap-size', (v) => { project.caption.size = v; }, () => project.caption.size],
    ['cap-bg', (v) => { project.caption.bg = v; }, () => project.caption.bg],
    ['cap-anim', (v) => { project.caption.anim = v; }, () => project.caption.anim],
    ['cap-color', (v) => { project.caption.color = v; }, () => project.caption.color],
    ['volume', (v) => { project.music.volume = v / 100; }, () => Math.round(project.music.volume * 100)],
    ['fade-in', (v) => { project.music.fadeIn = Number(v); }, () => project.music.fadeIn],
    ['fade-out', (v) => { project.music.fadeOut = Number(v); }, () => project.music.fadeOut],
    ['logo-pos', (v) => { project.logo.pos = v; }, () => project.logo.pos],
    ['logo-size', (v) => { project.logo.size = Number(v); }, () => project.logo.size],
    ['logo-opacity', (v) => { project.logo.opacity = v / 100; }, () => Math.round(project.logo.opacity * 100)],
  ];
  const CHECKS = [['duck', (v) => { project.music.duck = v; }, () => project.music.duck], ['end-fade', (v) => { project.endFade = v; }, () => project.endFade]];
  function syncPanels() {
    for (const [id, , get] of PANEL) $(id).value = get();
    for (const [id, , get] of CHECKS) $(id).checked = get();
  }
  const panelChanged = () => { project = V.normalizeProject(project); saveProject(); syncPanels(); if (!exporting) paint(); };
  for (const [id, put] of PANEL) $(id).addEventListener('change', (e) => { put(e.target.value); panelChanged(); });
  for (const [id, put] of CHECKS) $(id).addEventListener('change', (e) => { put(e.target.checked); panelChanged(); });

  $('music').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    stopPreview();
    const probe = h('audio', { preload: 'metadata' });
    const url = URL.createObjectURL(f);
    const done = (ok) => { URL.revokeObjectURL(url); if (!ok) return toast(t('music.bad')); setMusic(f, f.name); idb.put(MUSIC_KEY, f, f.name); };
    probe.addEventListener('loadedmetadata', () => done(true), { once: true });
    probe.addEventListener('error', () => done(false), { once: true });
    probe.src = url;
  });
  $('music-remove').addEventListener('click', () => { stopPreview(); setMusic(null); idb.del(MUSIC_KEY); });
  $('logo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!(await setLogo(f, f.name))) return toast(t('media.bad'));
    idb.put(LOGO_KEY, f, f.name);
    paint();
  });
  $('logo-remove').addEventListener('click', async () => { await setLogo(null); idb.del(LOGO_KEY); paint(); });

  const exportState = store.get('pgv.export', {});
  for (const id of ['quality', 'fps', 'bitrate']) {
    if (exportState[id]) $(id).value = exportState[id];
    $(id).addEventListener('change', () => store.set('pgv.export', { quality: $('quality').value, fps: $('fps').value, bitrate: $('bitrate').value }));
  }
  async function runExport(quality) {
    const res = await R.exportVideo(project, media, {
      quality, fps: $('fps').value, bitrate: $('bitrate').value, captions: $('captions').checked, logo: extra.logo,
      clipAudio: $('clip-audio').checked, music: extra.music, signal: exporting,
      onProgress: (p) => { $('progress').value = p; },
    });
    const name = V.fileName(project.title, V.extFor(res.mime));
    return { ...res, name, where: await saveFile(name, res.mime, res.blob) };
  }
  $('export').addEventListener('click', async () => {
    if (exporting) { exporting.cancelled = true; return; }
    if (!project.scenes.length) return toast(t('scene.none'));
    stopPreview();
    exporting = { cancelled: false };
    $('export').textContent = t('export.cancel');
    $('progress').hidden = false; $('progress').value = 0;
    $('export-status').textContent = t('export.running');
    try {
      const r = await runExport($('quality').value);
      $('export-status').textContent = t('export.done', r.width, r.height, (r.blob.size / 1048576).toFixed(1), r.where);
    } catch (e) {
      $('export-status').textContent = t('export.fail', why(e));
    }
    exporting = null;
    $('export').textContent = t('export');
    $('progress').hidden = true;
    paint();
  });

  const saved = (p) => p.then((where) => toast(t('saved', where)), (e) => toast(why(e)));
  $('save-srt').addEventListener('click', () => saved(saveFile(V.fileName(project.title, 'srt'), 'application/x-subrip', V.toSRT(project))));
  $('save-json').addEventListener('click', () => saved(saveFile(V.fileName(project.title, 'json'), 'application/json', JSON.stringify(project, null, 2))));
  $('open-json').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (f.size > 2 * 1048576) throw new Error('too big');
      const p = V.normalizeProject(JSON.parse(await f.text()));
      if (!p.scenes.length) throw new Error('empty');
      project = p; saveProject(); refresh();
      toast(t('opened', p.title, p.scenes.length));
    } catch (_) { toast(t('open.bad')); }
  });

  // ---- start -----------------------------------------------------------------------------
  // Fills every static label, then redraws whatever the current tab built from code.
  function applyLang() {
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
    for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t(el.dataset.ph);
    for (const b of $('lang').children) { b.classList.toggle('on', b.dataset.lang === lang); b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); }
    $('seek').setAttribute('aria-label', t('seek'));
    for (const id of ['undo', 'redo']) { $(id).title = t(id); $(id).setAttribute('aria-label', t(id)); }
    $('play').textContent = t(pv.playing ? 'pause' : 'play');
    $('export').textContent = t(exporting ? 'export.cancel' : 'export');
    fillSelects();
    if (tab === 'export') { syncPanels(); renderSummary(); } else refresh();
  }
  $('lang').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    t = I.translate(lang);
    store.set('pgv.lang', lang);
    if (!exporting) $('export-status').textContent = '';
    applyLang();
  });
  setMusic(null);
  setLogo(null);
  applyLang();
  const selftest = /[?&]selftest=1/.test(location.search);
  idb.open().then(async () => {
    if (selftest) return;
    // Files whose scene no longer exists (deleted in an earlier session) are cleaned up here.
    const ids = new Set(project.scenes.map((s) => s.id));
    for (const key of (await idb.tx('readonly', (st) => st.getAllKeys())) || []) {
      if (key !== MUSIC_KEY && key !== LOGO_KEY && !ids.has(key)) idb.del(key);
    }
    for (const s of project.scenes) {
      const rec = await idb.tx('readonly', (st) => st.get(s.id));
      if (rec && rec.blob) await attach(s.id, rec.blob, rec.name);
    }
    const mus = await idb.tx('readonly', (st) => st.get(MUSIC_KEY));
    if (mus && mus.blob) setMusic(mus.blob, mus.name);
    const logo = await idb.tx('readonly', (st) => st.get(LOGO_KEY));
    if (logo && logo.blob) await setLogo(logo.blob, logo.name);
    // Loading files takes a moment: only jump to the scenes if the user has not moved on already.
    if (project.scenes.length && tab === 'brief') show('scenes'); else refresh();
  });

  // ?selftest=1 renders a short demo end to end and reports on the console. Used by the
  // automated tests (desktop Chromium and the Android emulator); it never touches saved work.
  if (selftest) {
    (async () => {
      try {
        project = V.buildStoryboard({ brief: 'Sunrise over the beach.\nA guest opens the curtains.', aspect: '9:16', totalSeconds: 3, style: 'hospitality', title: 'pgv selftest' });
        Object.assign(project.scenes[0], { look: 'film' });
        Object.assign(project.scenes[1], { transition: 'slide-left', look: 'warm' });
        project = V.normalizeProject({ ...project, caption: { anim: 'rise', bg: 'outline' } });
        show('export');
        exporting = { cancelled: false };
        const r = await runExport(360);
        exporting = null;
        const head = new Uint8Array(await r.blob.slice(0, 12).arrayBuffer());
        window.PGV_SELFTEST = { ok: true, bytes: r.blob.size, mime: r.mime, head: Array.from(head), where: r.where, width: r.width, height: r.height };
        console.log(`PGV_SELFTEST ok bytes=${r.blob.size} mime=${r.mime} saved=${r.where}`);
      } catch (e) {
        window.PGV_SELFTEST = { ok: false, error: String(e && e.message ? e.message : e) };
        console.log('PGV_SELFTEST fail ' + window.PGV_SELFTEST.error);
      }
    })();
  }
})();
