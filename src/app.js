// PromptGate Video UI. Four tabs: brief → scenes → prompts per AI tool → local export.
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
  const media = new Map(); // sceneId -> { type, el, url, name }
  const saveProject = () => { store.set('pgv.project', project); renderSummary(); };

  // Imported images and clips are kept in IndexedDB so they survive closing the app.
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
  };
  function attach(sceneId, blob, name) {
    return new Promise((res) => {
      detach(sceneId, true);
      const type = /^video\//.test(blob.type) ? 'video' : 'image';
      const url = URL.createObjectURL(blob);
      const el = type === 'video' ? h('video', { muted: true, playsInline: true, preload: 'auto', loop: true }) : new Image();
      const done = (ok) => { if (ok) media.set(sceneId, { type, el, url, name }); else URL.revokeObjectURL(url); res(ok); };
      el.addEventListener(type === 'video' ? 'loadeddata' : 'load', () => done(true), { once: true });
      el.addEventListener('error', () => done(false), { once: true });
      el.src = url;
    });
  }
  function detach(sceneId, keepStored) {
    const m = media.get(sceneId);
    if (m) { if (m.type === 'video') m.el.pause(); URL.revokeObjectURL(m.url); media.delete(sceneId); }
    if (!keepStored) idb.tx('readwrite', (s) => s.delete(sceneId));
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
    if (tab === 'scenes') renderScenes();
    if (tab === 'prompts') renderPrompts();
    if (tab === 'export') setupPreview();
    window.scrollTo(0, 0);
  }
  $('nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); });
  function renderSummary() {
    const n = project.scenes.length;
    $('summary').textContent = n ? t('summary', project.title, n, V.fmtTime(V.totalDuration(project)), project.aspect) : t('summary.empty');
  }

  // ---- brief -----------------------------------------------------------------------------
  // Select boxes are rebuilt on a language switch; the chosen value is kept.
  function fillSelect(id, entries) {
    const el = $(id), cur = el.value;
    el.replaceChildren(...entries.map(([value, textContent]) => h('option', { value, textContent })));
    if (cur) el.value = cur;
  }
  function fillSelects() {
    fillSelect('aspect', V.ASPECTS.map((a) => [a, t('aspect.' + a)]));
    fillSelect('style', Object.entries(V.STYLES).map(([k, s]) => [k, V.label(s, lang)]));
    fillSelect('quality', [['720', '720p'], ['1080', '1080p'], ['360', t('quality.360')]]);
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
    for (const id of [...media.keys()]) detach(id);
    project = V.buildStoryboard({ brief: b.brief, consistency: b.consistency, aspect: b.aspect, style: b.style, totalSeconds: b.total });
    store.set('pgv.brief', b);
    saveProject();
    show('scenes');
  });

  // ---- scenes ----------------------------------------------------------------------------
  const options = (map, cur) => Object.entries(map).map(([k, v]) => h('option', { value: k, selected: k === cur, textContent: V.label(v, lang) }));
  function renderScenes() {
    const box = $('scenes');
    box.replaceChildren();
    if (!project.scenes.length) box.append(h('p', { className: 'muted', textContent: t('scene.none') }));
    project.scenes.forEach((s, i) => {
      const m = media.get(s.id);
      const set = (key, cast) => (e) => { s[key] = cast ? cast(e.target.value) : e.target.value; project = V.normalizeProject(project); saveProject(); };
      const move = (d) => () => { const j = i + d; if (j < 0 || j >= project.scenes.length) return; project.scenes.splice(j, 0, project.scenes.splice(i, 1)[0]); saveProject(); renderScenes(); };
      const pick = h('input', { type: 'file', accept: 'image/*,video/*', hidden: true, on: { change: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (!(await attach(s.id, f, f.name))) return toast(t('media.bad'));
        idb.tx('readwrite', (st) => st.put({ blob: f, name: f.name }, s.id));
        renderScenes();
      } } });
      box.append(h('div', { className: 'card' },
        h('h3', null, t('scene.n', i + 1), h('span', null,
          h('button', { textContent: '↑', title: t('scene.up'), disabled: i === 0, on: { click: move(-1) } }), ' ',
          h('button', { textContent: '↓', title: t('scene.down'), disabled: i === project.scenes.length - 1, on: { click: move(1) } }), ' ',
          h('button', { textContent: '✕', title: t('scene.delete'), on: { click: () => { detach(s.id); project.scenes.splice(i, 1); saveProject(); renderScenes(); } } }))),
        h('label', { textContent: t('scene.text') }),
        h('textarea', { rows: 2, value: s.text, maxLength: V.LIMITS.text, on: { change: set('text') } }),
        h('label', { textContent: t('scene.caption') }),
        h('input', { type: 'text', value: s.caption, maxLength: 160, on: { change: set('caption') } }),
        h('div', { className: 'row' },
          h('div', null, h('label', { textContent: t('scene.seconds') }), h('input', { type: 'number', min: V.LIMITS.sceneMin, max: V.LIMITS.sceneMax, step: 0.5, value: s.duration, on: { change: (e) => { set('duration', Number)(e); renderScenes(); } } })),
          h('div', null, h('label', { textContent: t('scene.shot') }), h('select', { on: { change: set('shot') } }, options(V.SHOTS, s.shot))),
          h('div', null, h('label', { textContent: t('scene.motion') }), h('select', { on: { change: set('motion') } }, options(V.MOTIONS, s.motion))),
          h('div', null, h('label', { textContent: t('scene.transition') }), h('select', { on: { change: set('transition') } }, options(V.TRANSITIONS, s.transition)))),
        h('div', { className: 'acts' }, pick,
          h('button', { textContent: m ? t('media.change') : t('media.add'), on: { click: () => pick.click() } }),
          m && h('button', { textContent: t('media.remove'), on: { click: () => { detach(s.id); renderScenes(); } } }),
          m && h('span', { className: 'media', textContent: (m.type === 'video' ? '🎬 ' : '🖼 ') + (m.name || '') }))));
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

  // ---- preview + export ------------------------------------------------------------------
  const pv = { ctx: null, t: 0, playing: false, timer: 0, last: 0 };
  let exporting = null;
  const drawOpts = () => ({ captions: $('captions').checked });
  function paint() {
    const total = V.totalDuration(project);
    const at = R.drawFrame(pv.ctx, project, pv.t, media, drawOpts());
    R.syncVideos(project, media, at, pv.playing);
    $('seek').value = total ? Math.round((pv.t / total) * 1000) : 0;
    $('clock').textContent = `${V.fmtTime(pv.t)} / ${V.fmtTime(total)}`;
  }
  function setupPreview() {
    const c = $('preview');
    const d = V.dims(project.aspect, 360);
    c.width = d.width; c.height = d.height;
    pv.ctx = c.getContext('2d');
    pv.t = 0;
    paint();
  }
  function stopPreview() {
    pv.playing = false;
    clearInterval(pv.timer);
    R.syncVideos(project, media, null, false);
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
    pv.timer = setInterval(() => {
      const now = performance.now();
      pv.t += (now - pv.last) / 1000; pv.last = now;
      if (pv.t >= total) { pv.t = total; paint(); return stopPreview(); }
      paint();
    }, 1000 / 30);
  });
  $('seek').addEventListener('input', () => { if (exporting) return; stopPreview(); pv.t = ($('seek').value / 1000) * V.totalDuration(project); paint(); });
  $('captions').addEventListener('change', () => { if (pv.ctx && !exporting) paint(); });

  let musicEl = null;
  $('music').addEventListener('change', (e) => {
    if (musicEl) { URL.revokeObjectURL(musicEl.src); musicEl = null; }
    const f = e.target.files[0];
    if (f) musicEl = h('audio', { src: URL.createObjectURL(f), preload: 'auto' });
  });

  async function runExport(quality) {
    const res = await R.exportVideo(project, media, {
      quality, captions: $('captions').checked, clipAudio: $('clip-audio').checked,
      music: musicEl, musicVolume: $('volume').value / 100, signal: exporting,
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
      for (const id of [...media.keys()]) detach(id);
      project = p; saveProject(); setupPreview();
      toast(t('opened', p.title, p.scenes.length));
    } catch (_) { toast(t('open.bad')); }
  });

  // ---- start -----------------------------------------------------------------------------
  // External links leave the app: Android opens them in the browser (see MainActivity).
  // Fills every static label, then redraws whatever the current tab built from code.
  function applyLang() {
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
    for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t(el.dataset.ph);
    for (const b of $('lang').children) { b.classList.toggle('on', b.dataset.lang === lang); b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); }
    $('seek').setAttribute('aria-label', t('seek'));
    $('play').textContent = t(pv.playing ? 'pause' : 'play');
    $('export').textContent = t(exporting ? 'export.cancel' : 'export');
    fillSelects();
    renderSummary();
    if (tab === 'scenes') renderScenes();
    if (tab === 'prompts') renderPrompts();
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
  applyLang();
  const selftest = /[?&]selftest=1/.test(location.search);
  idb.open().then(async () => {
    if (selftest) return;
    for (const s of project.scenes) {
      const rec = await idb.tx('readonly', (st) => st.get(s.id));
      if (rec && rec.blob) await attach(s.id, rec.blob, rec.name);
    }
    if (project.scenes.length) show('scenes');
  });

  // ?selftest=1 renders a 3-second demo end to end and reports on the console. Used by the
  // automated tests (desktop Chromium and the Android emulator); it never touches saved work.
  if (selftest) {
    (async () => {
      try {
        project = V.buildStoryboard({ brief: 'Sunrise over the beach.\nA guest opens the curtains.', aspect: '9:16', totalSeconds: 3, style: 'hospitality', title: 'pgv selftest' });
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
