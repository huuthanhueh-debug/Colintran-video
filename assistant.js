'use strict';
// PromptGate Video assistant: turns a plain-language request into edit operations for the
// project by asking Claude. Runs only inside the local server (server.js), never in the
// browser or the APK, so credentials stay on this computer.
//   1. ANTHROPIC_API_KEY set  → Claude API (tool use).
//   2. otherwise `claude` CLI → reuses the Claude Code login on this machine, no API key.
// Whatever comes back is treated as untrusted: the browser applies it through
// PGVideo.applyOps, which whitelists fields and clamps every value.
const { spawn } = require('child_process');
const V = require('./src/core.js');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const DEFAULT_MODEL = 'claude-opus-5-5';
// Models that accept the server-side refusal fallback; others would reject the parameter.
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-fable-5-1'];
const MAX_TURNS = 12;
const TIMEOUT_MS = 120000;

const names = (map) => Object.keys(map);
const SET_PROPERTIES = {
  // scene fields
  text: { type: 'string', description: 'Scene description, used to build prompts for AI video tools.' },
  caption: { type: 'string', description: 'Caption drawn on the video for this scene. Empty string for none.' },
  duration: { type: 'number', description: `Scene length in seconds, ${V.LIMITS.sceneMin}-${V.LIMITS.sceneMax}.` },
  shot: { type: 'string', enum: names(V.SHOTS) },
  motion: { type: 'string', enum: names(V.MOTIONS), description: 'Camera move applied to a still image.' },
  transition: { type: 'string', enum: names(V.TRANSITIONS), description: 'How this scene enters from the previous one.' },
  transDur: { type: 'number', description: 'Transition length in seconds, 0.2-2.' },
  trimIn: { type: 'number', description: 'Video clips only: start of the used part, seconds into the source clip.' },
  trimOut: { type: 'number', description: 'Video clips only: end of the used part in source seconds. 0 = clip end.' },
  speed: { type: 'number', description: `Video clips only: playback speed, ${V.LIMITS.speedMin}-${V.LIMITS.speedMax}.` },
  volume: { type: 'number', description: 'Video clips only: clip sound level, 0-1.' },
  fit: { type: 'string', enum: names(V.FITS), description: 'cover fills the frame (crops); contain shows the whole picture over a blurred copy.' },
  look: { type: 'string', enum: names(V.LOOKS), description: 'Colour look.' },
  brightness: { type: 'number', description: '50-150, 100 = unchanged.' },
  contrast: { type: 'number', description: '50-150, 100 = unchanged.' },
  saturation: { type: 'number', description: '0-200, 100 = unchanged.' },
  // project fields (update_project only)
  title: { type: 'string' },
  aspect: { type: 'string', enum: V.ASPECTS },
  style: { type: 'string', enum: names(V.STYLES), description: 'Visual style used in generated prompts and title cards.' },
  consistency: { type: 'string', description: 'Character, product or setting to keep identical across scenes.' },
  endFade: { type: 'boolean', description: 'Fade to black at the end of the video.' },
};
const GROUP_PROPERTIES = {
  captionStyle: { type: 'object', description: 'update_project only: how captions look across the whole video (the caption text itself is the scene field "caption").', properties: {
    pos: { type: 'string', enum: names(V.CAP_POS) }, size: { type: 'string', enum: names(V.CAP_SIZE) }, bg: { type: 'string', enum: names(V.CAP_BG) },
    anim: { type: 'string', enum: names(V.CAP_ANIM) }, color: { type: 'string', description: 'Hex colour like #ffffff.' } } },
  music: { type: 'object', description: 'update_project only: background music mix.', properties: {
    volume: { type: 'number', description: '0-1.' }, fadeIn: { type: 'number', description: 'Seconds, 0-10.' }, fadeOut: { type: 'number', description: 'Seconds, 0-10.' },
    duck: { type: 'boolean', description: 'Lower the music while a clip with sound plays.' } } },
  logo: { type: 'object', description: 'update_project only: logo overlay placement.', properties: {
    pos: { type: 'string', enum: names(V.LOGO_POS) }, size: { type: 'number', description: 'Percent of frame width, 6-40.' }, opacity: { type: 'number', description: '0.1-1.' } } },
};

// "set" carries scene fields for scene operations and project fields for update_project.
const TOOL = {
  name: 'edit_project',
  description: 'Apply edits to the video project. Call once with every change the user asked for. Operations run in order; scene numbers are 1-based and refer to the project as it is when each operation runs (after the earlier ones).',
  input_schema: {
    type: 'object',
    properties: {
      ops: {
        type: 'array',
        description: `Edits to apply, at most ${V.MAX_OPS}.`,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['update_scene', 'add_scene', 'delete_scene', 'move_scene', 'duplicate_scene', 'split_scene', 'update_project'] },
            scene: { type: 'integer', description: 'Scene number (1-based). Required for every operation except add_scene and update_project.' },
            after: { type: 'integer', description: 'add_scene: insert after this scene number; 0 inserts at the start. Omit to append.' },
            to: { type: 'integer', description: 'move_scene: new scene number.' },
            at: { type: 'number', description: 'split_scene: seconds from the start of that scene where it is cut.' },
            set: { type: 'object', description: 'Fields to change. Scene fields for update_scene / add_scene, project fields for update_project.', properties: { ...SET_PROPERTIES, ...GROUP_PROPERTIES } },
          },
          required: ['op'],
        },
      },
    },
    required: ['ops'],
  },
};

const SYSTEM = [
  'You are the editing assistant inside PromptGate Video, an offline video editor. The user asks for changes in plain language, in Vietnamese or English. You make them by calling the edit_project tool, then tell the user what changed in one or two short sentences, in the language they wrote in.',
  '',
  'The project is a sequence of scenes. Each scene has a description, a caption shown on screen, a duration, a camera move, an entry transition, an optional image or video clip the user attached, and colour settings. The project also has a caption style, a music mix and a logo placement. Every message from the user comes with the current project as JSON, including each scene\'s number and whether it has an image, a video (with the source clip length) or no media.',
  '',
  'Guidelines:',
  '- Change only what the request covers. Leave everything else as it is, including captions and descriptions you were not asked to rewrite.',
  '- Trim, speed and clip volume only affect scenes whose media is a video. If the user asks for them on another scene, say why it has no effect instead of changing it.',
  '- You cannot see the pictures or clips, attach or remove files, or export. If a request needs one of those, explain briefly what the user can do in the app.',
  '- When the user asks a question or the request is too vague to act on, answer or ask one short question without calling the tool.',
  '- Write captions in the language the existing captions use unless the user asks otherwise. Scene descriptions work best in English because they feed AI video tools.',
  '- The user can undo your edit with one tap, so act on reasonable interpretations rather than asking for confirmation.',
].join('\n');

function describeProject(project, media) {
  const p = V.normalizeProject(project);
  const info = media && typeof media === 'object' ? media : {};
  return {
    title: p.title, aspect: p.aspect, style: p.style, consistency: p.consistency, endFade: p.endFade,
    totalSeconds: V.totalDuration(p), captionStyle: p.caption, music: p.music, logo: p.logo,
    scenes: p.scenes.map((s, i) => {
      const m = info[s.id] && typeof info[s.id] === 'object' ? info[s.id] : {};
      const out = { scene: i + 1, text: s.text, caption: s.caption, duration: s.duration, shot: s.shot, motion: s.motion, transition: s.transition, transDur: s.transDur,
        fit: s.fit, look: s.look, brightness: s.brightness, contrast: s.contrast, saturation: s.saturation, media: m.type === 'video' || m.type === 'image' ? m.type : 'none' };
      if (out.media === 'video') Object.assign(out, { clipSeconds: Number(m.seconds) > 0 ? Math.round(Number(m.seconds) * 10) / 10 : null, trimIn: s.trimIn, trimOut: s.trimOut, speed: s.speed, volume: s.volume });
      return out;
    }),
  };
}

// Chat history → API messages. Only the newest user turn carries the project.
function buildMessages(history, project, media) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, text: m.text.trim().slice(0, 4000) }))
    .slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;
  const last = turns.length - 1;
  return turns.map((m, i) => ({
    role: m.role,
    content: i === last ? `Current project:\n${JSON.stringify(describeProject(project, media))}\n\nRequest: ${m.text}` : m.text,
  }));
}

function buildBody(messages, model) {
  const body = { model, max_tokens: 16000, system: SYSTEM, tools: [TOOL], output_config: { effort: 'medium' }, messages };
  if (FALLBACK_MODELS.includes(model)) body.fallbacks = 'default';
  return body;
}

// API response → { reply, ops } or { error }.
function readResponse(json) {
  if (!json || !Array.isArray(json.content)) return { error: 'upstream' };
  if (json.stop_reason === 'refusal') return { error: 'refused' };
  const reply = json.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
  const ops = [];
  for (const b of json.content) {
    if (b && b.type === 'tool_use' && b.name === TOOL.name && b.input && Array.isArray(b.input.ops)) ops.push(...b.input.ops);
  }
  if (json.stop_reason === 'max_tokens' && !ops.length) return { error: 'tooLong' };
  return { reply, ops: ops.slice(0, V.MAX_OPS) };
}

async function viaApi(messages, env, fetchImpl) {
  const model = env.PGV_MODEL || DEFAULT_MODEL;
  const headers = { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION };
  const body = buildBody(messages, model);
  if (body.fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(env.PGV_ANTHROPIC_URL || API_URL, { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(body) });
    if (res.status === 401 || res.status === 403) return { error: 'auth' };
    if (res.status === 429) return { error: 'rate' };
    if (res.status === 400 || res.status === 404 || res.status === 413) return { error: 'badRequest' };
    if (!res.ok) return { error: 'upstream' };
    return readResponse(await res.json());
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
}

// ---- Claude Code CLI ---------------------------------------------------------------------
function run(bin, args, input, env, timeoutMs) {
  return new Promise((resolve) => {
    let out = '', done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let child;
    try { child = spawn(bin, args, { env, shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch (_) { return resolve(null); }
    const timer = setTimeout(() => { try { child.kill(); } catch (_) { /* already gone */ } finish(null); }, timeoutMs);
    child.stdout.on('data', (d) => { if (out.length < 2000000) out += d; });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? out : null));
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
function cliEnv(env) {
  const e = { ...env };
  delete e.CLAUDECODE; delete e.CLAUDE_CODE_ENTRYPOINT; delete e.CLAUDE_CODE_SSE_PORT;
  return e;
}
const cliBin = (env) => env.PGV_CLAUDE_BIN || env.PROMPTGATE_CLAUDE_BIN || 'claude';
async function hasCli(env) {
  if (env.PGV_NO_CLI) return false;
  const v = await run(cliBin(env), ['--version'], '', cliEnv(env), 8000);
  return !!(v && v.trim());
}
// The CLI has no tool channel here, so it answers with one JSON object instead.
function parseCliReply(text) {
  const raw = String(text || '').trim();
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(raw.slice(a, b + 1));
      if (j && typeof j === 'object') return { reply: typeof j.reply === 'string' ? j.reply.trim() : '', ops: Array.isArray(j.ops) ? j.ops.slice(0, V.MAX_OPS) : [] };
    } catch (_) { /* fall through: treat it as a plain answer */ }
  }
  return raw ? { reply: raw, ops: [] } : { error: 'upstream' };
}
async function viaCli(messages, env) {
  const system = `${SYSTEM}\n\nYou have no tools in this session. Reply with one JSON object and nothing else: {"reply": "<what you tell the user>", "ops": [<operations>]}. Use an empty ops array when nothing should change. The operations follow this JSON Schema:\n${JSON.stringify(TOOL.input_schema.properties.ops)}`;
  const prompt = messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  // --tools "" starts the session with no tools: it can only answer, not touch files.
  const out = await run(cliBin(env), ['-p', '--output-format', 'text', '--tools', '', '--system-prompt', system], prompt, cliEnv(env), TIMEOUT_MS);
  return out == null ? { error: 'cli' } : parseCliReply(out);
}

// ---- entry points ------------------------------------------------------------------------
let cliCache = null; // probing the CLI spawns a process, so remember the answer per env object
async function mode(env) {
  if (env.ANTHROPIC_API_KEY) return 'api';
  if (!cliCache || cliCache.env !== env) cliCache = { env, has: hasCli(env) };
  return (await cliCache.has) ? 'cli' : null;
}
async function status(env) {
  const m = await mode(env);
  return { local: true, assistant: m, model: m === 'api' ? env.PGV_MODEL || DEFAULT_MODEL : m === 'cli' ? 'Claude Code' : null };
}
// input: { project, media, messages: [{ role, text }] } → { reply, ops } or { error }.
async function ask(input, env, fetchImpl) {
  const m = await mode(env);
  if (!m) return { error: 'noAssistant' };
  const messages = buildMessages(input && input.messages, input && input.project, input && input.media);
  if (!messages) return { error: 'badRequest' };
  return m === 'api' ? viaApi(messages, env, fetchImpl || fetch) : viaCli(messages, env);
}

module.exports = { ask, status, buildMessages, buildBody, readResponse, parseCliReply, describeProject, TOOL, SYSTEM, DEFAULT_MODEL, API_VERSION, MAX_TURNS };
