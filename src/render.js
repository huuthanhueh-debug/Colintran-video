// PromptGate Video renderer (browser only): composites a project frame on a canvas (media with
// trim/speed/look, transitions between two scenes, animated captions, logo), mixes clip and
// music audio, and records the result with MediaRecorder. Everything runs on the device.
(function (root) {
  'use strict';
  const V = root.PGVideo;
  const HAS_FILTER = (() => { try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch (_) { return false; } })();

  // One spare canvas per frame size, used to build a scene as a single layer during transitions.
  let layer = null;
  function layerFor(W, H) {
    if (!layer) layer = document.createElement('canvas');
    if (layer.width !== W || layer.height !== H) { layer.width = W; layer.height = H; }
    return layer.getContext('2d');
  }
  const sizeOf = (m) => (m.type === 'video' ? [m.el.videoWidth, m.el.videoHeight] : [m.el.naturalWidth, m.el.naturalHeight]);

  function drawMedia(ctx, project, scene, index, local, m, W, H) {
    const [sw, sh] = m ? sizeOf(m) : [0, 0];
    const css = V.filterCss(scene);
    if (!sw || !sh) { // title card: style gradient + scene number, so a storyboard with no media still previews
      const c = V.STYLES[project.style].colors;
      const p = Math.min(1, local / scene.duration);
      const g = ctx.createLinearGradient(0, 0, W * (0.6 + 0.4 * p), H);
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
      if (HAS_FILTER && css) ctx.filter = css;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (HAS_FILTER) ctx.filter = 'none';
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.font = `700 ${Math.round(Math.min(W, H) * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), W / 2, H * 0.42);
      return;
    }
    const tf = V.motionTransform(m.type === 'video' ? 'static' : scene.motion, Math.min(1, local / scene.duration));
    const put = (mode, filter, zoom) => {
      const r = V.fitRect(sw, sh, W, H, mode);
      const w = r.w * zoom, h = r.h * zoom;
      if (HAS_FILTER) ctx.filter = filter || 'none';
      ctx.drawImage(m.el, (W - w) / 2 + tf.tx * W, (H - h) / 2 + tf.ty * H, w, h);
      if (HAS_FILTER) ctx.filter = 'none';
    };
    if (scene.fit === 'contain') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      put('cover', `blur(${Math.round(Math.min(W, H) * 0.04)}px) brightness(0.55) ${css}`.trim(), 1.15);
      put('contain', css, tf.scale > 1 ? 1 + (tf.scale - 1) / 2 : 1);
    } else put('cover', css, tf.scale);
  }

  function drawCaption(ctx, project, scene, local, W, H) {
    if (!scene.caption) return;
    const st = project.caption;
    const rev = V.captionReveal(st.anim, local, scene.caption, scene.duration);
    if (rev.alpha <= 0 || rev.chars <= 0) return;
    const size = Math.round(Math.min(W, H) * V.CAP_SIZE[st.size].k);
    ctx.font = `600 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const measure = (s) => ctx.measureText(s).width;
    // Wrap the full text so lines do not jump while the typewriter fills them in.
    let left = rev.chars;
    const lines = V.wrapLines(scene.caption, W * 0.84, measure, 3).map((l) => { const part = l.slice(0, Math.max(0, left)); left -= l.length + 1; return part; }).filter(Boolean);
    if (!lines.length) return;
    const lh = size * 1.3, pad = size * 0.5;
    const boxH = lines.length * lh + pad * 2;
    const boxW = Math.min(W * 0.92, Math.max(...lines.map(measure)) + pad * 2.4);
    const y0 = (st.pos === 'top' ? H * 0.09 : st.pos === 'middle' ? (H - boxH) / 2 : H - boxH - H * 0.09) + rev.dy * size * 0.9;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * rev.alpha;
    if (st.bg === 'box') { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect((W - boxW) / 2, y0, boxW, boxH); }
    ctx.fillStyle = st.color;
    if (st.bg === 'outline') { ctx.lineJoin = 'round'; ctx.lineWidth = size / 5; ctx.strokeStyle = 'rgba(0,0,0,.9)'; }
    if (st.bg === 'none') { ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size * 0.35; ctx.shadowOffsetY = size * 0.06; }
    lines.forEach((l, i) => {
      const y = y0 + pad + lh * (i + 0.5);
      if (st.bg === 'outline') ctx.strokeText(l, W / 2, y);
      ctx.fillText(l, W / 2, y);
    });
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.globalAlpha = prev;
  }

  function drawScene(ctx, project, index, local, media, opts, W, H) {
    const scene = project.scenes[index];
    drawMedia(ctx, project, scene, index, local, media && media.get(scene.id), W, H);
    if (!opts || opts.captions !== false) drawCaption(ctx, project, scene, local, W, H);
  }

  // media: Map sceneId -> { type: 'image' | 'video', el }.
  // opts: { captions, logo: HTMLImageElement, guides }. Returns V.sceneAt(project, t).
  function drawFrame(ctx, project, t, media, opts) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const at = V.sceneAt(project, t);
    if (!at) return null;
    const tr = at.trans;
    if (!tr) drawScene(ctx, project, at.index, at.local, media, opts, W, H);
    else {
      const p = tr.p, type = tr.prev < 0 ? 'fade' : tr.type;
      const scene = (i, local) => { const l = layerFor(W, H); l.globalAlpha = 1; l.clearRect(0, 0, W, H); drawScene(l, project, i, local, media, opts, W, H); return layer; };
      if (type !== 'fade') { // outgoing scene, frozen on its last frame
        const old = scene(tr.prev, project.scenes[tr.prev].duration);
        if (type === 'slide-left') ctx.drawImage(old, -p * W, 0);
        else if (type === 'slide-up') ctx.drawImage(old, 0, -p * H);
        else if (type === 'zoom') { const k = 1 + p * 0.35; ctx.drawImage(old, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k); }
        else ctx.drawImage(old, 0, 0);
      }
      const cur = scene(at.index, at.local);
      if (type === 'slide-left') ctx.drawImage(cur, (1 - p) * W, 0);
      else if (type === 'slide-up') ctx.drawImage(cur, 0, (1 - p) * H);
      else if (type === 'wipe') { const w = Math.round(p * W); if (w > 0) ctx.drawImage(cur, 0, 0, w, H, 0, 0, w, H); }
      else { ctx.globalAlpha = p; ctx.drawImage(cur, 0, 0); ctx.globalAlpha = 1; } // fade, dissolve, zoom
    }
    if (at.out < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - at.out})`; ctx.fillRect(0, 0, W, H); }
    const logo = opts && opts.logo;
    if (logo && logo.naturalWidth) {
      const r = V.logoRect(project.logo, W, H, logo.naturalWidth, logo.naturalHeight);
      ctx.globalAlpha = project.logo.opacity * at.out;
      ctx.drawImage(logo, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    if (opts && opts.guides) drawGuides(ctx, project.aspect, W, H);
    return at;
  }

  // Preview only: the area that stays clear of app buttons and captions on social feeds.
  function drawGuides(ctx, aspect, W, H) {
    const z = aspect === '9:16' ? { l: 0.05, t: 0.1, r: 0.15, b: 0.2 } : { l: 0.05, t: 0.05, r: 0.05, b: 0.05 };
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = Math.max(1, W / 360);
    ctx.setLineDash([W / 60, W / 60]);
    ctx.strokeRect(W * z.l, H * z.t, W * (1 - z.l - z.r), H * (1 - z.t - z.b));
    ctx.restore();
  }

  // Keeps scene videos on the right source frame: trim, speed, looping inside the trim. While
  // playing only the current scene's clip runs; while scrubbing clips are paused and seeked.
  function syncVideos(project, media, at, playing) {
    if (!media) return;
    media.forEach((m, id) => {
      if (m.type !== 'video') return;
      const el = m.el;
      const on = at && at.scene.id === id;
      if (!on) { if (!el.paused) el.pause(); return; }
      const want = V.clipTime(at.scene, at.local, el.duration);
      const seek = (tol) => { if (Math.abs(el.currentTime - want) > tol) { try { el.currentTime = want; } catch (_) { /* not seekable yet */ } } };
      if (!playing) { if (!el.paused) el.pause(); seek(0.05); return; }
      if (el.playbackRate !== at.scene.speed) el.playbackRate = at.scene.speed;
      if (el.paused) { seek(0.05); el.play().catch(() => {}); } else seek(0.35 * Math.max(1, at.scene.speed));
    });
  }

  // ---- audio -----------------------------------------------------------------------------
  // One AudioContext for the app's lifetime: a media element can be wired to Web Audio only
  // once, so preview (speakers) and export (recorder) share the same nodes and just re-route.
  const AE = { ac: null, nodes: new WeakMap() };
  function context() {
    if (AE.ac) return AE.ac;
    const AC = root.AudioContext || root.webkitAudioContext;
    try { AE.ac = AC ? new AC() : null; } catch (_) { AE.ac = null; }
    return AE.ac;
  }
  function setLevel(el, level, target) {
    const ac = context();
    let n = AE.nodes.get(el);
    if (!n && level <= 0) { if (el.tagName === 'VIDEO') el.muted = true; return; } // nothing to hear: do not wire it up yet
    if (ac && !n) {
      try {
        const gain = ac.createGain();
        ac.createMediaElementSource(el).connect(gain);
        gain.connect(ac.destination);
        n = { gain, to: ac.destination };
        AE.nodes.set(el, n);
      } catch (_) { n = null; }
    }
    if (!n) { el.muted = level <= 0; el.volume = Math.min(1, Math.max(0, level)); return; } // no Web Audio: speakers only
    const to = target || ac.destination;
    if (n.to !== to) { n.gain.disconnect(); n.gain.connect(to); n.to = to; }
    el.muted = false; el.volume = 1;
    n.gain.gain.setTargetAtTime(level, ac.currentTime, 0.04);
  }
  const hasSound = (el) => el.webkitAudioDecodedByteCount === undefined || el.webkitAudioDecodedByteCount > 0;
  // Sets every level for time t. opts: { clipAudio, music (audio element), target (recorder node) }.
  function mixAudio(project, media, at, t, opts) {
    let ducked = false;
    if (media) media.forEach((m, id) => {
      if (m.type !== 'video') return;
      const on = at && at.scene.id === id && opts.clipAudio !== false;
      const level = on ? at.scene.volume : 0;
      if (on && level > 0.05 && hasSound(m.el)) ducked = true;
      setLevel(m.el, level, opts.target);
    });
    if (opts.music) setLevel(opts.music, at ? V.musicGain(project, t, ducked) : 0, opts.target);
  }
  function resumeAudio() {
    const ac = context();
    if (!ac || ac.state === 'running') return Promise.resolve(!!ac);
    return Promise.race([ac.resume().then(() => true, () => false), new Promise((res) => setTimeout(() => res(ac.state === 'running'), 800))]);
  }

  function supportedMime() {
    return typeof MediaRecorder === 'undefined' ? '' : V.pickMime((m) => MediaRecorder.isTypeSupported(m));
  }

  // Real-time export. opts: { quality, fps, bitrate ('low' | 'medium' | 'high'), captions, logo,
  // music, clipAudio, onProgress(0..1), signal: { cancelled } }.
  // Resolves { blob, mime, width, height, audio }. Rejects with a short code the UI translates.
  async function exportVideo(project, media, opts) {
    opts = opts || {};
    const total = V.totalDuration(project);
    const mime = supportedMime();
    if (!total) throw new Error('noScenes');
    if (!mime) throw new Error('noRecorder');
    const { width, height } = V.dims(project.aspect, opts.quality);
    const fps = [24, 30, 60].includes(Number(opts.fps)) ? Number(opts.fps) : 30;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(fps);

    // Audio is added only when there is something to hear and the context really runs:
    // a silent, suspended track can stall the recorder.
    const wantsAudio = !!opts.music || (opts.clipAudio !== false && media && [...media.values()].some((m) => m.type === 'video'));
    let dest = null;
    if (wantsAudio && (await resumeAudio())) {
      try { dest = context().createMediaStreamDestination(); dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr)); } catch (_) { dest = null; }
    }
    const audio = { clipAudio: opts.clipAudio, music: opts.music, target: dest };

    return new Promise((resolve, reject) => {
      const chunks = [];
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: V.bitrate(width, height, fps, opts.bitrate) }); }
      catch (e) { stream.getTracks().forEach((tr) => tr.stop()); return reject(e); }
      let timer = null, failed = null;
      const finish = () => {
        clearInterval(timer);
        syncVideos(project, media, null, false);
        if (opts.music) opts.music.pause();
        mixAudio(project, media, null, 0, { clipAudio: opts.clipAudio, music: opts.music }); // silence, back on the speakers
        stream.getTracks().forEach((tr) => tr.stop());
      };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = (e) => { failed = e.error || new Error('recordError'); try { rec.stop(); } catch (_) { finish(); reject(failed); } };
      rec.onstop = () => {
        finish();
        if (failed) return reject(failed);
        if (opts.signal && opts.signal.cancelled) return reject(new Error('cancelled'));
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        if (!blob.size) return reject(new Error('emptyVideo'));
        resolve({ blob, mime: mime.split(';')[0], width, height, audio: !!dest });
      };
      const frame = (t, playing) => {
        const at = V.sceneAt(project, t);
        syncVideos(project, media, at, playing);
        if (dest) mixAudio(project, media, at, t, audio);
        drawFrame(ctx, project, t, media, opts);
      };
      frame(0, false);
      rec.start(1000);
      if (opts.music && dest) { try { opts.music.currentTime = 0; } catch (_) { /* not loaded */ } opts.music.loop = true; opts.music.play().catch(() => {}); }
      const t0 = performance.now();
      // setInterval, not requestAnimationFrame: rAF stops when the screen dims or the tab hides.
      timer = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        if (t >= total || (opts.signal && opts.signal.cancelled)) { clearInterval(timer); drawFrame(ctx, project, total, media, opts); try { rec.stop(); } catch (_) { /* already stopped */ } return; }
        frame(t, true);
        if (opts.onProgress) opts.onProgress(t / total);
      }, 1000 / fps);
    });
  }

  root.PGRender = { drawFrame, syncVideos, mixAudio, resumeAudio, supportedMime, exportVideo };
})(typeof self !== 'undefined' ? self : this);
