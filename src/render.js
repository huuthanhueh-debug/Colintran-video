// PromptGate Video renderer (browser only): draws a project frame on a canvas and records the
// canvas to a video file with MediaRecorder. Everything runs on the device, nothing is uploaded.
(function (root) {
  'use strict';
  const V = root.PGVideo;

  function cover(ctx, src, sw, sh, W, H, tf) {
    if (!sw || !sh) return;
    const s = Math.max(W / sw, H / sh) * tf.scale;
    const w = sw * s, h = sh * s;
    ctx.drawImage(src, (W - w) / 2 + tf.tx * W, (H - h) / 2 + tf.ty * H, w, h);
  }

  // media: Map sceneId -> { type: 'image' | 'video', el }. opts: { captions: bool }.
  function drawFrame(ctx, project, t, media, opts) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const at = V.sceneAt(project, t);
    if (!at) return null;
    const { scene } = at;
    const m = media && media.get(scene.id);
    const tf = V.motionTransform(m && m.type === 'video' ? 'static' : scene.motion, at.progress);
    ctx.globalAlpha = at.alpha;
    let drawn = false;
    if (m && m.type === 'image' && m.el.naturalWidth) { cover(ctx, m.el, m.el.naturalWidth, m.el.naturalHeight, W, H, tf); drawn = true; }
    if (m && m.type === 'video' && m.el.videoWidth) { cover(ctx, m.el, m.el.videoWidth, m.el.videoHeight, W, H, tf); drawn = true; }
    if (!drawn) { // title card: style gradient + scene number, so a storyboard with no media still previews
      const c = V.STYLES[project.style].colors;
      const g = ctx.createLinearGradient(0, 0, W * (0.6 + 0.4 * at.progress), H);
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      ctx.font = `700 ${Math.round(Math.min(W, H) * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(at.index + 1), W / 2, H * 0.42);
    }
    if ((!opts || opts.captions !== false) && scene.caption) {
      const size = Math.round(Math.min(W, H) * 0.052);
      ctx.font = `600 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = V.wrapLines(scene.caption, W * 0.84, (s) => ctx.measureText(s).width, 3);
      const lh = size * 1.3, pad = size * 0.5;
      const boxH = lines.length * lh + pad * 2;
      const boxW = Math.min(W * 0.92, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2.4);
      const y0 = H - boxH - H * 0.07;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect((W - boxW) / 2, y0, boxW, boxH);
      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + pad + lh * (i + 0.5)));
    }
    ctx.globalAlpha = 1;
    return at;
  }

  // Start (or stop) scene videos so the frame grabbed for time t is the right one.
  function syncVideos(project, media, at, playing) {
    if (!media) return;
    media.forEach((m, id) => {
      if (m.type !== 'video') return;
      const on = playing && at && at.scene.id === id;
      if (on && m.el.paused) {
        try { m.el.currentTime = Math.min(at.local, Math.max(0, (m.el.duration || 0) - 0.05)); } catch (_) { /* not seekable yet */ }
        m.el.play().catch(() => {});
      } else if (!on && !m.el.paused) m.el.pause();
    });
  }

  function supportedMime() {
    return typeof MediaRecorder === 'undefined' ? '' : V.pickMime((m) => MediaRecorder.isTypeSupported(m));
  }

  // Real-time export. opts: { quality, fps, captions, music (HTMLAudioElement), musicVolume,
  // clipAudio, onProgress(0..1), signal: { cancelled } }. Resolves { blob, mime, width, height }.
  function exportVideo(project, media, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const total = V.totalDuration(project);
      const mime = supportedMime();
      if (!total) return reject(new Error('Chưa có cảnh nào để xuất.'));
      if (!mime) return reject(new Error('Thiết bị này không hỗ trợ ghi video (MediaRecorder).'));
      const { width, height } = V.dims(project.aspect, opts.quality);
      const fps = opts.fps || 30;
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(fps);
      const restore = [];
      let ac = null;
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        const wantClip = opts.clipAudio !== false && media && [...media.values()].some((m) => m.type === 'video');
        if (AC && (opts.music || wantClip)) {
          ac = new AC();
          const dest = ac.createMediaStreamDestination();
          const route = (el, volume) => {
            el._pgNode = el._pgNode && el._pgNode.context === ac ? el._pgNode : ac.createMediaElementSource(el);
            const gain = ac.createGain();
            gain.gain.value = volume;
            el._pgNode.connect(gain); gain.connect(dest);
            const was = el.muted; el.muted = false;
            restore.push(() => { el.muted = was; try { el._pgNode.disconnect(); } catch (_) { /* already gone */ } el._pgNode = null; });
          };
          if (wantClip) media.forEach((m) => { if (m.type === 'video') route(m.el, 1); });
          if (opts.music) { route(opts.music, opts.musicVolume == null ? 0.6 : opts.musicVolume); opts.music.loop = true; opts.music.currentTime = 0; }
          dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
          if (ac.state === 'suspended') ac.resume().catch(() => {});
        }
      } catch (_) { /* audio is optional: fall back to a silent video */ }

      const chunks = [];
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(width * height * fps * 0.12) }); }
      catch (e) { return reject(e); }
      let timer = null, failed = null;
      const finish = () => {
        clearInterval(timer);
        syncVideos(project, media, null, false);
        if (opts.music) opts.music.pause();
        restore.forEach((fn) => fn());
        stream.getTracks().forEach((tr) => tr.stop());
        if (ac) ac.close().catch(() => {});
      };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = (e) => { failed = e.error || new Error('Lỗi ghi video'); try { rec.stop(); } catch (_) { finish(); reject(failed); } };
      rec.onstop = () => {
        finish();
        if (failed) return reject(failed);
        if (opts.signal && opts.signal.cancelled) return reject(new Error('Đã huỷ.'));
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        if (!blob.size) return reject(new Error('Video rỗng: thiết bị không mã hoá được định dạng này.'));
        resolve({ blob, mime: mime.split(';')[0], width, height });
      };
      drawFrame(ctx, project, 0, media, opts);
      rec.start(1000);
      if (opts.music) opts.music.play().catch(() => {});
      const t0 = performance.now();
      // setInterval, not requestAnimationFrame: rAF stops when the screen dims or the tab hides.
      timer = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        if (t >= total || (opts.signal && opts.signal.cancelled)) { clearInterval(timer); drawFrame(ctx, project, total, media, opts); try { rec.stop(); } catch (_) { /* already stopped */ } return; }
        syncVideos(project, media, V.sceneAt(project, t), true);
        drawFrame(ctx, project, t, media, opts);
        if (opts.onProgress) opts.onProgress(t / total);
      }, 1000 / fps);
    });
  }

  root.PGRender = { drawFrame, syncVideos, supportedMime, exportVideo };
})(typeof self !== 'undefined' ? self : this);
