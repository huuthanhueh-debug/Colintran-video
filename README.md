# PromptGate Video

Offline video studio. Brief → storyboard → prompts shaped for 11 AI video tools (Veo 3, Runway Gen-4, Kling, HeyGen, Synthesia, InVideo AI, CapCut AI, Canva AI, Sora, Pika, Luma) → attach the generated clips → edit → export, all on the device. Vietnamese and English UI.

[Tiếng Việt (đầy đủ)](README.vi.md)

## Run

```bash
npm start            # starts the app and opens it in your browser (Node.js 18+, no npm install)
npm run video        # server only, http://127.0.0.1:4173
npm test             # logic, server, assistant (mock Claude), packaging; real renders when Playwright is installed
ANDROID_HOME=/path/to/sdk npm run build:apk   # → dist/promptgate-video.apk (JDK 17+)
```

Or double-click `PromptGate-Video.cmd` (Windows), `PromptGate-Video.command` (macOS) or run `./promptgate-video.sh`. If the app is already running the launcher just reopens it; a busy port moves to the next one.

## Autopilot

Local tab → **Do it all**: a topic, up to 8 article links, your images / clips / a whole folder and music. One click collects the pages' text, writes the script (Claude when available, grounded in the sources; an offline extractive writer otherwise), places the media, exports the video and saves `.srt`, `.json` and a prompts file for all 11 tools. A failing step is reported and skipped. On the APK it runs offline (no links, no Claude).

## Editing

Timeline with playhead, split at playhead, duplicate, undo/redo; per-clip trim, speed and volume; seven transitions; colour looks; caption styles and animation; music fades with auto-ducking; logo overlay; export at 24/30/60 fps.

## Claude assistant (local only)

The **Local** tab has a chat that edits the project from plain-language requests. It runs in the local server, never in the browser or the APK:

1. `ANTHROPIC_API_KEY` set → Claude API (`claude-opus-5-5` by default, override with `PGV_MODEL`; server-side refusal fallback is on).
2. otherwise the `claude` CLI (Claude Code) signed in on this machine.

The key stays on the computer. The server listens on `127.0.0.1` only and refuses requests from other sites. Claude's instructions go through the same validated path as manual edits (whitelisted fields, clamped values). Claude receives the project text and settings, not your media files.

## Layout

| Path | What |
|---|---|
| `src/` | The web app (also bundled into the APK): `core.js` logic, `render.js` compositor and audio, `app.js` UI, `i18n.js` strings |
| `server.js`, `assistant.js`, `collect.js` | Zero-dependency local server and launcher, the Claude bridge (edits and storyboard writing), the web-page collector |
| `android/` | WebView activity, manifest (no permissions), `build.js` (aapt2 → javac → d8 → zipalign → apksigner) |
| `tests/video.js` | All tests |
| `.github/workflows/ci.yml` | Tests, APK build, emulator run, release (active when this folder is the repository root) |

MIT licence.
