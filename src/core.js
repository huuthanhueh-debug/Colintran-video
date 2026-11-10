// PromptGate Video core: pure logic shared by the browser app, the Android WebView and the Node
// tests. No DOM, no Node APIs. Storyboard from a brief, per-tool prompt packs for 11 AI video
// tools, timeline maths for the local renderer, subtitles, project validation.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PGVideo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHECKED = '2026-11-10';
  const LIMITS = { scenes: 30, sceneMin: 1, sceneMax: 60, text: 600, total: 600 };
  const ASPECTS = ['9:16', '16:9', '1:1'];
  const FADE = 0.4;

  // Tool profiles. Numbers come from vendor pages and press summaries read on CHECKED; they move
  // fast, so the UI shows the date and a link. `clips` = fixed lengths per generation (s),
  // `range` = any length between two bounds. `order` = recommended order of prompt elements.
  const TOOLS = [
    { id: 'veo', name: 'Google Veo 3', version: 'Veo 3.1', category: 'generative', clips: [4, 6, 8], aspects: ['16:9', '9:16'], audio: true,
      inputs: { vi: 'text, ảnh, khung đầu + cuối, ảnh tham chiếu', en: 'text, image, first + last frame, reference images' }, order: ['camera', 'subject', 'context', 'style', 'audio'],
      tips: { vi: ['Mở đầu bằng góc máy và chuyển động máy, rồi mới tới chủ thể và hành động.', 'Có âm thanh gốc: mô tả tiếng động, nhạc nền; lời thoại đặt trong ngoặc kép.'], en: ['Open with the shot size and camera move, then the subject and action.', 'Native audio: describe sound effects and music; put dialogue in quotes.'] },
      url: 'https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1' },
    { id: 'runway', name: 'Runway Gen-4', version: 'Gen-4.5', category: 'generative', clips: [5, 10], aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], audio: true,
      inputs: { vi: 'text, ảnh', en: 'text, image' }, order: ['subject', 'camera', 'context', 'style'],
      tips: { vi: ['Tả cả hình ảnh lẫn chuyển động; câu khẳng định, ngắn, không dùng câu phủ định.', 'Mạnh nhất khi có ảnh đầu vào: prompt chỉ cần tả chuyển động.'], en: ['Describe both the picture and the motion; short positive sentences, no negatives.', 'Strongest with an input image: the prompt then only needs the motion.'] },
      url: 'https://help.runwayml.com/hc/en-us/articles/46974685288467' },
    { id: 'kling', name: 'Kling AI', version: 'Kling 4.0', category: 'generative', range: [3, 30], aspects: ['16:9', '9:16', '1:1', '21:9'], audio: true,
      inputs: { vi: 'text, khung đầu + cuối, keyframe, ảnh tham chiếu', en: 'text, first + last frame, keyframes, reference images' }, order: ['subject', 'context', 'camera', 'style', 'audio'],
      tips: { vi: ['Không có công thức cứng: nêu đủ chủ thể, hành động, bối cảnh, máy quay, ánh sáng, không khí.', 'Gọi tên cỡ cảnh và chuyển động máy; lời thoại ghi rõ ai nói.'], en: ['No fixed formula: cover subject, action, setting, camera, lighting and atmosphere.', 'Name the framing and the camera move; label who speaks each line.'] },
      url: 'https://kling.ai/blog/kling-ai-prompt-guide' },
    { id: 'heygen', name: 'HeyGen', version: 'Avatar V', category: 'avatar', aspects: ['16:9', '9:16', '1:1', '4:5', '5:4'], audio: true,
      inputs: { vi: 'kịch bản, ảnh hoặc video mẫu, audio', en: 'script, photo or sample video, audio' }, order: [],
      tips: { vi: ['Viết lời thoại như nói: câu ngắn, mỗi cảnh một ý.', 'Chèn nhịp nghỉ ngắn giữa các ý để avatar không nói dồn.'], en: ['Write the script as speech: short sentences, one idea per scene.', 'Add short pauses between ideas so the avatar does not rush.'] },
      url: 'https://help.heygen.com/en/articles/11269603-heygen-avatar-iv-complete-guide' },
    { id: 'synthesia', name: 'Synthesia', version: 'Express-2', category: 'avatar', aspects: ['16:9'], audio: true,
      inputs: { vi: 'kịch bản', en: 'script' }, order: [],
      tips: { vi: ['Mỗi cảnh một đoạn lời thoại, kèm chữ trên màn hình ngắn gọn.', 'Hợp video đào tạo, SOP, thông báo nội bộ.'], en: ['One block of script per scene, with brief on-screen text.', 'Good for training, SOP and internal announcement videos.'] },
      url: 'https://help.synthesia.io/en/articles/8368969-video-faqs' },
    { id: 'invideo', name: 'InVideo AI', version: '', category: 'editor', aspects: ['16:9', '9:16', '1:1'], audio: true,
      inputs: { vi: 'prompt hoặc kịch bản', en: 'prompt or script' }, order: [],
      tips: { vi: ['Một prompt cho cả video: chủ đề, độ dài, ngang/dọc, có voiceover và phụ đề hay không.', 'Chọn đúng workflow (shorts, explainer, script-to-video).'], en: ['One prompt for the whole video: topic, length, landscape or portrait, voiceover and subtitles or not.', 'Pick the right workflow (shorts, explainer, script-to-video).'] },
      url: 'https://help-ai.invideo.io/what-is-magic-box-and-how-to-use-it/' },
    { id: 'capcut', name: 'CapCut AI', version: 'AI video maker', category: 'editor', aspects: ['9:16', '16:9'], audio: true,
      inputs: { vi: 'kịch bản hoặc prompt', en: 'script or prompt' }, order: [],
      tips: { vi: ['Thứ tự: hướng cảnh → các hành động theo trình tự → trạng thái kết thúc → tỉ lệ + thời lượng.', 'Chọn tỉ lệ, giọng đọc và thời lượng trước khi bấm tạo.'], en: ['Order: scene direction → actions in sequence → final state → aspect + duration.', 'Set aspect, voice and duration before you generate.'] },
      url: 'https://www.capcut.com/create/ai-video-generator/capcut-script-to-video-guide' },
    { id: 'canva', name: 'Canva AI (Magic Media)', version: 'Create a Video Clip (Veo 3)', category: 'generative', clips: [8], aspects: ['16:9'], audio: true,
      inputs: { vi: 'text', en: 'text' }, order: ['camera', 'subject', 'context', 'style', 'audio'],
      tips: { vi: ['Chạy trên Veo 3: dùng cùng cấu trúc prompt với Veo.', 'Chỉ 16:9, tối đa 8 giây, có giới hạn lượt mỗi tháng.'], en: ['Runs on Veo 3: use the same prompt structure as Veo.', '16:9 only, up to 8 seconds, with a monthly cap.'] },
      url: 'https://www.canva.com/features/ai-video-generator/' },
    { id: 'sora', name: 'Sora (OpenAI)', version: 'Sora 2', category: 'generative', clips: [4, 8, 12], aspects: ['16:9', '9:16'], audio: true, discontinued: true,
      inputs: { vi: 'text, ảnh', en: 'text, image' }, order: ['subject', 'context', 'camera', 'style', 'audio'],
      tips: { vi: ['OpenAI đã đóng Sora (app 04/2026, API 09/2026). Prompt vẫn tạo để tham khảo hoặc dùng lại cho Veo/Kling.', 'Tả như một shot list: cỡ cảnh, ống kính, ánh sáng, hành động theo nhịp.'], en: ['OpenAI closed Sora (app 04/2026, API 09/2026). Prompts are still built for reference or reuse in Veo/Kling.', 'Write it like a shot list: framing, lens, lighting, action beat by beat.'] },
      url: 'https://venturebeat.com/technology/openai-is-shutting-down-sora-its-powerful-ai-video-app' },
    { id: 'pika', name: 'Pika Labs', version: 'Pika 2.5', category: 'generative', clips: [5, 10], aspects: ['16:9', '9:16', '1:1', '4:5', '5:4', '3:2', '2:3'], audio: false,
      inputs: { vi: 'text, ảnh, khung đầu + cuối', en: 'text, image, first + last frame' }, order: ['subject', 'camera', 'context', 'style'],
      tips: { vi: ['Prompt ngắn, một hành động chính cho mỗi clip.', 'Không có âm thanh gốc: thêm nhạc ở bước Xuất của app này.'], en: ['Short prompts, one main action per clip.', 'No native audio: add music in the Export step of this app.'] },
      url: 'https://pika.art/faq' },
    { id: 'luma', name: 'Luma Dream Machine', version: 'Ray3.2', category: 'generative', clips: [5, 10], aspects: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], audio: false,
      inputs: { vi: 'text, ảnh, keyframe, video (Modify)', en: 'text, image, keyframes, video (Modify)' }, order: ['camera', 'subject', 'context', 'style'],
      tips: { vi: ['Phản hồi mạnh với thuật ngữ máy quay, ống kính, ánh sáng chuyên nghiệp.', 'Không có âm thanh gốc: thêm nhạc ở bước Xuất của app này.'], en: ['Responds strongly to professional camera, lens and lighting terms.', 'No native audio: add music in the Export step of this app.'] },
      url: 'https://lumalabs.ai/learning-center/articles/luma-video-models-field-guide' },
  ];

  const STYLES = {
    cinematic: { name: 'Cinematic', vi: 'Điện ảnh', en: 'cinematic look, shallow depth of field, soft natural light, rich color grade, 35mm film feel', audio: 'subtle ambient sound, gentle orchestral score', colors: ['#0f172a', '#7c3aed'] },
    commercial: { name: 'Product commercial', vi: 'Quảng cáo sản phẩm', en: 'premium commercial look, clean studio lighting, crisp detail, polished color', audio: 'upbeat modern music, crisp product sound design', colors: ['#111827', '#f59e0b'] },
    hospitality: { name: 'Hotel & travel', vi: 'Khách sạn & du lịch', en: 'luxury travel film look, warm golden-hour light, inviting atmosphere, smooth gimbal movement', audio: 'ocean breeze and soft ambient room tone, relaxed lounge music', colors: ['#0c4a6e', '#f97316'] },
    documentary: { name: 'Documentary', vi: 'Tài liệu', en: 'documentary style, handheld realism, natural available light, true-to-life color', audio: 'natural location sound, minimal music', colors: ['#1c1917', '#65a30d'] },
    social: { name: 'Social media', vi: 'Mạng xã hội', en: 'energetic social video look, bright punchy color, fast dynamic framing', audio: 'trending upbeat track, snappy sound effects', colors: ['#831843', '#06b6d4'] },
    anime: { name: 'Anime', vi: 'Hoạt hình anime', en: 'high-quality anime style, clean line art, vivid cel shading, expressive lighting', audio: 'emotive anime soundtrack, stylised sound effects', colors: ['#1e1b4b', '#fb7185'] },
  };

  const SHOTS = {
    wide: { name: 'Wide', vi: 'Toàn cảnh', en: 'Wide establishing shot' },
    medium: { name: 'Medium', vi: 'Trung cảnh', en: 'Medium shot' },
    close: { name: 'Close-up', vi: 'Cận cảnh', en: 'Close-up shot' },
    detail: { name: 'Detail', vi: 'Đặc tả', en: 'Extreme close-up detail shot' },
    aerial: { name: 'Aerial', vi: 'Trên cao', en: 'Aerial drone shot' },
  };
  const MOTIONS = {
    'push-in': { name: 'Push in', vi: 'Tiến vào', en: 'slow push-in' },
    'pull-out': { name: 'Pull out', vi: 'Lùi ra', en: 'slow pull-out' },
    'pan-right': { name: 'Pan right', vi: 'Lia phải', en: 'smooth pan right' },
    'pan-left': { name: 'Pan left', vi: 'Lia trái', en: 'smooth pan left' },
    'tilt-up': { name: 'Tilt up', vi: 'Ngước lên', en: 'gentle tilt up' },
    static: { name: 'Static', vi: 'Máy tĩnh', en: 'locked-off static camera' },
  };
  const TRANSITIONS = { fade: { name: 'Fade', vi: 'Mờ dần' }, cut: { name: 'Hard cut', vi: 'Cắt thẳng' } };
  // UI label of a style / shot / motion / transition entry in the chosen language.
  const label = (entry, lang) => (lang === 'en' ? entry.name : entry.vi);
  const SHOT_CYCLE = ['wide', 'medium', 'close', 'medium', 'detail', 'wide'];
  const MOTION_CYCLE = ['push-in', 'pan-right', 'static', 'pan-left', 'pull-out', 'tilt-up'];

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const half = (n) => Math.round(n * 2) / 2;
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const words = (s) => (clean(s) ? clean(s).split(' ').length : 0);
  const tool = (id) => TOOLS.find((t) => t.id === id) || null;
  let seq = 0;
  const newId = () => 's' + Date.now().toString(36) + (seq++).toString(36);

  // One scene per line or sentence. Bullets and "Cảnh 1:" style prefixes are dropped.
  function splitBrief(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const l = line.replace(/^\s*(?:[-*•]+|\d+[.)]|(?:cảnh|scene)\s*\d+\s*[:.\-–])\s*/i, '');
      for (const s of l.split(/(?<=[.!?…])\s+/)) if (clean(s)) out.push(clean(s).slice(0, LIMITS.text));
    }
    return out;
  }

  function caption(text) {
    const t = clean(text).replace(/[.…]+$/, '');
    return t.length <= 90 ? t : t.slice(0, 87).replace(/\s+\S*$/, '') + '…';
  }

  // Split `total` seconds across scenes by word count, half-second steps, at least `min` each.
  function distribute(texts, total, min) {
    const n = texts.length;
    if (!n) return [];
    const w = texts.map((t) => Math.max(1, words(t)));
    const sum = w.reduce((a, b) => a + b, 0);
    total = Math.max(total, n * min);
    const d = w.map((x) => clamp(half((total * x) / sum), min, LIMITS.sceneMax));
    let diff = half(total - d.reduce((a, b) => a + b, 0));
    for (let guard = 0; Math.abs(diff) >= 0.5 && guard < 1000; guard++) {
      const step = diff > 0 ? 0.5 : -0.5;
      const i = d.reduce((best, v, k) => {
        if (v + step < min || v + step > LIMITS.sceneMax) return best;
        return best < 0 || (step > 0 ? v < d[best] : v > d[best]) ? k : best;
      }, -1);
      if (i < 0) break;
      d[i] += step; diff = half(diff - step);
    }
    return d;
  }

  function buildStoryboard(input) {
    const o = input || {};
    let parts = splitBrief(o.brief);
    const max = clamp(Math.round(num(o.maxScenes, 12)), 1, LIMITS.scenes);
    while (parts.length > max) { // merge the shortest neighbours until it fits
      let k = 0;
      for (let i = 1; i < parts.length - 1; i++) if (words(parts[i]) + words(parts[i + 1]) < words(parts[k]) + words(parts[k + 1])) k = i;
      parts.splice(k, 2, (parts[k] + ' ' + parts[k + 1]).slice(0, LIMITS.text));
    }
    const total = clamp(num(o.totalSeconds, 30), 2, LIMITS.total);
    const dur = distribute(parts, total, 2);
    return normalizeProject({
      title: clean(o.title) || caption(parts[0] || 'Video mới').slice(0, 60),
      aspect: o.aspect, style: o.style, consistency: o.consistency,
      scenes: parts.map((text, i) => ({
        text, caption: caption(text), duration: dur[i],
        shot: SHOT_CYCLE[i % SHOT_CYCLE.length], motion: MOTION_CYCLE[i % MOTION_CYCLE.length],
        transition: 'fade',
      })),
    });
  }

  // Accepts anything (imported JSON, old saves) and returns a safe project.
  function normalizeProject(p) {
    p = p && typeof p === 'object' ? p : {};
    const scenes = (Array.isArray(p.scenes) ? p.scenes : []).slice(0, LIMITS.scenes).map((s) => {
      s = s && typeof s === 'object' ? s : {};
      const text = clean(s.text).slice(0, LIMITS.text);
      return {
        id: typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : newId(),
        text,
        caption: s.caption == null ? caption(text) : clean(s.caption).slice(0, 160),
        duration: clamp(half(num(s.duration, 4)), LIMITS.sceneMin, LIMITS.sceneMax),
        shot: SHOTS[s.shot] ? s.shot : 'medium',
        motion: MOTIONS[s.motion] ? s.motion : 'push-in',
        transition: TRANSITIONS[s.transition] ? s.transition : 'fade',
      };
    });
    const ids = new Set();
    for (const s of scenes) { if (ids.has(s.id)) s.id = newId(); ids.add(s.id); }
    return {
      version: 1,
      title: clean(p.title).slice(0, 80) || 'Video mới',
      aspect: ASPECTS.includes(p.aspect) ? p.aspect : '9:16',
      style: STYLES[p.style] ? p.style : 'cinematic',
      consistency: clean(p.consistency).slice(0, 300),
      scenes,
    };
  }

  // ---- per-tool prompts -----------------------------------------------------------------
  const ratio = (a) => { const [w, h] = a.split(':').map(Number); return w / h; };
  function nearestAspect(t, aspect) {
    if (t.aspects.includes(aspect)) return aspect;
    const want = Math.log(ratio(aspect));
    return t.aspects.slice().sort((a, b) => Math.abs(Math.log(ratio(a)) - want) - Math.abs(Math.log(ratio(b)) - want))[0];
  }
  // How to cover `seconds` with this tool: length to request and how many generations.
  function fitClip(t, seconds) {
    if (t.range) {
      const [lo, hi] = t.range;
      if (seconds <= hi) return { seconds: clamp(Math.ceil(seconds), lo, hi), count: 1 };
      return { seconds: hi, count: Math.ceil(seconds / hi) };
    }
    if (!t.clips) return { seconds, count: 1 };
    const fit = t.clips.find((c) => c >= seconds);
    if (fit) return { seconds: fit, count: 1 };
    const maxClip = t.clips[t.clips.length - 1];
    return { seconds: maxClip, count: Math.ceil(seconds / maxClip) };
  }
  const sentence = (s) => { s = clean(s); return s ? (/[.!?…]$/.test(s) ? s : s + '.') : ''; };

  function scenePrompt(t, scene, project) {
    const st = STYLES[project.style];
    const piece = {
      camera: SHOTS[scene.shot].en + ', ' + MOTIONS[scene.motion].en,
      subject: scene.text,
      context: project.consistency ? 'Keep consistent across shots: ' + project.consistency : '',
      style: st.en.charAt(0).toUpperCase() + st.en.slice(1),
      audio: t.audio ? 'Audio: ' + st.audio : '',
    };
    return t.order.map((k) => sentence(piece[k])).filter(Boolean).join(' ') + ' No subtitles, no on-screen text.';
  }

  const MSG = {
    vi: {
      scene: 'Cảnh', about: 'khoảng', whole: 'Cả video',
      gone: (n) => `${n} đã ngừng hoạt động; prompt chỉ để tham khảo.`,
      aspect: (n, a, b) => `${n} không hỗ trợ ${a}; dùng ${b} rồi crop khi dựng.`,
      split: (k, n) => `${k} cảnh dài hơn một lần tạo của ${n}: tạo nhiều clip (số lần ghi ở từng cảnh) hoặc rút ngắn cảnh.`,
      silent: (n) => `${n} không tạo âm thanh: thêm nhạc ở tab Xuất.`,
      spoken: 'Lời thoại được đọc đúng như bạn viết: soạn bằng ngôn ngữ muốn avatar nói.',
    },
    en: {
      scene: 'Scene', about: 'about', whole: 'Whole video',
      gone: (n) => `${n} has been shut down; prompts are for reference only.`,
      aspect: (n, a, b) => `${n} does not support ${a}; use ${b} and crop when editing.`,
      split: (k, n) => `${k} scene(s) run longer than one ${n} generation: make several clips (count shown on each scene) or shorten the scene.`,
      silent: (n) => `${n} does not generate audio: add music in the Export tab.`,
      spoken: 'The script is read exactly as written: write it in the language the avatar should speak.',
    },
  };

  function buildPack(toolId, proj, lang) {
    const m = MSG[lang === 'en' ? 'en' : 'vi'];
    const t = tool(toolId);
    if (!t) throw new Error('Unknown tool: ' + toolId);
    const project = normalizeProject(proj);
    const aspect = nearestAspect(t, project.aspect);
    const total = totalDuration(project);
    const st = STYLES[project.style];
    const warnings = [];
    if (t.discontinued) warnings.push(m.gone(t.name));
    if (aspect !== project.aspect) warnings.push(m.aspect(t.name, project.aspect, aspect));
    if (!project.scenes.length) return { tool: t, mode: t.category === 'editor' ? 'whole' : 'scene', aspect, items: [], warnings };
    const items = [];
    if (t.category === 'generative') {
      let split = 0;
      project.scenes.forEach((s, i) => {
        const fit = fitClip(t, s.duration);
        if (fit.count > 1) split++;
        items.push({ sceneId: s.id, label: `${m.scene} ${i + 1} · ${fit.count > 1 ? fit.count + ' × ' : ''}${fit.seconds}s · ${aspect}`, text: scenePrompt(t, s, project), seconds: fit.seconds, count: fit.count });
      });
      if (split) warnings.push(m.split(split, t.name));
      if (!t.audio) warnings.push(m.silent(t.name));
    } else if (t.category === 'avatar') {
      project.scenes.forEach((s, i) => items.push({
        sceneId: s.id, label: `${m.scene} ${i + 1} · ${m.about} ${s.duration}s`, seconds: s.duration, count: 1,
        text: `Scene ${i + 1}\nScript: ${sentence(s.text)}\nOn-screen text: ${s.caption}\nAvatar framing: ${SHOTS[s.shot].en.toLowerCase()}, ${aspect}`,
      }));
      warnings.push(m.spoken);
    } else {
      const lines = project.scenes.map((s, i) => `${i + 1}. (${s.duration}s) ${sentence(s.text)}`).join('\n');
      const head = t.id === 'capcut'
        ? `Scene direction: ${st.en}.\nActions in order:\n${lines}\nFinal state: end on the last scene, hold for one second.\nFormat: ${aspect}, about ${Math.round(total)} seconds, voiceover and subtitles on.`
        : `Create a ${Math.round(total)}-second ${aspect} video titled "${project.title}".\nStyle: ${st.en}.\nVoiceover: yes. Subtitles: yes. Background music: ${st.audio}.\nFollow this scene order exactly:\n${lines}`;
      items.push({ sceneId: null, label: `${m.whole} · ${Math.round(total)}s · ${aspect}`, text: head + (project.consistency ? `\nKeep consistent: ${project.consistency}.` : ''), seconds: total, count: 1 });
    }
    return { tool: t, mode: t.category === 'editor' ? 'whole' : 'scene', aspect, items, warnings };
  }
  const packText = (pack) => pack.items.map((it) => `# ${it.label}\n${it.text}`).join('\n\n');

  // ---- timeline + renderer maths ---------------------------------------------------------
  const totalDuration = (project) => project.scenes.reduce((a, s) => a + s.duration, 0);
  function timeline(project) {
    let t = 0;
    return project.scenes.map((scene) => ({ scene, start: t, end: (t += scene.duration) }));
  }
  // Which scene is on screen at time t, how far through it, and its fade opacity (0..1).
  function sceneAt(project, t) {
    const tl = timeline(project);
    if (!tl.length) return null;
    t = clamp(num(t, 0), 0, tl[tl.length - 1].end);
    let i = tl.findIndex((x) => t < x.end);
    if (i < 0) i = tl.length - 1;
    const { scene, start } = tl[i];
    const local = t - start;
    let alpha = 1;
    if (scene.transition === 'fade') {
      const f = Math.min(FADE, scene.duration / 3);
      alpha = clamp(Math.min(local / f, (scene.duration - local) / f), 0, 1);
      if (i === tl.length - 1 && scene.duration - local <= 0) alpha = 0;
    }
    return { index: i, scene, local, progress: clamp(local / scene.duration, 0, 1), alpha };
  }
  // Ken Burns transform: scale >= 1 and offsets as a fraction of the frame, always covering it.
  function motionTransform(motion, p) {
    p = clamp(num(p, 0), 0, 1);
    const pan = 0.06;
    switch (motion) {
      case 'push-in': return { scale: 1 + 0.12 * p, tx: 0, ty: 0 };
      case 'pull-out': return { scale: 1.12 - 0.12 * p, tx: 0, ty: 0 };
      case 'pan-right': return { scale: 1 + 2 * pan, tx: pan - 2 * pan * p, ty: 0 };
      case 'pan-left': return { scale: 1 + 2 * pan, tx: -pan + 2 * pan * p, ty: 0 };
      case 'tilt-up': return { scale: 1 + 2 * pan, tx: 0, ty: -pan + 2 * pan * p };
      default: return { scale: 1, tx: 0, ty: 0 };
    }
  }
  function dims(aspect, quality) {
    const q = Number(quality) === 1080 ? 1080 : Number(quality) === 360 ? 360 : 720;
    const long = Math.round((q * 16) / 9 / 2) * 2;
    if (aspect === '16:9') return { width: long, height: q };
    if (aspect === '1:1') return { width: q, height: q };
    return { width: q, height: long };
  }
  // Greedy word wrap. `measure(str)` returns a width; over-long words are kept on their own line.
  function wrapLines(text, maxWidth, measure, maxLines) {
    const lines = [];
    let cur = '';
    for (const w of clean(text).split(' ').filter(Boolean)) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && measure(next) > maxWidth) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    }
    return lines;
  }
  const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  function pickMime(isSupported) {
    for (const m of MIMES) { try { if (isSupported(m)) return m; } catch (_) { /* keep looking */ } }
    return '';
  }
  const extFor = (mime) => (/mp4/.test(mime || '') ? 'mp4' : 'webm');
  function fileName(title, ext) {
    const base = clean(title).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video';
    return base + '.' + ext;
  }
  function srtTime(t) {
    const ms = Math.round(t * 1000);
    const p = (n, l) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor(ms / 60000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)},${p(ms % 1000, 3)}`;
  }
  function toSRT(project) {
    return timeline(project).filter((x) => x.scene.caption).map((x, i) => `${i + 1}\n${srtTime(x.start)} --> ${srtTime(x.end)}\n${x.scene.caption}\n`).join('\n');
  }
  function fmtTime(t) {
    t = Math.max(0, Math.round(num(t, 0)));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  return {
    CHECKED, LIMITS, ASPECTS, FADE, TOOLS, STYLES, SHOTS, MOTIONS, TRANSITIONS, MIMES,
    tool, label, splitBrief, caption, distribute, buildStoryboard, normalizeProject, nearestAspect, fitClip,
    buildPack, packText, totalDuration, timeline, sceneAt, motionTransform, dims, wrapLines, pickMime,
    extFor, fileName, toSRT, fmtTime, newId,
  };
});
