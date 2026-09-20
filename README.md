<!-- Built by scripts/build-public-mcp-repo.mjs in the AudioLab monorepo.
     Edit mcp/README.md there, not this copy. -->

# @audiolabtools/mcp-server

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server that gives any
MCP-capable AI (Claude Desktop, Claude Code, Cursor, and others) ten audio-analysis
tools, backed by the hosted **AudioLab** API. It is a thin HTTP client: **no local audio
engine, no ffmpeg, nothing to compile.** It can analyse a **public URL** or a **local file**
on your machine.

## Install

Point your MCP client at the package via `npx` (nothing to install globally):

```json
{
  "mcpServers": {
    "audiolab": {
      "command": "npx",
      "args": ["-y", "@audiolabtools/mcp-server"],
      "env": { "AUDIOLAB_API_KEY": "al_live_yourkey" }
    }
  }
}
```

Get a key: sign in at **https://audiolab.tools/account** and generate one (free tier available).

## Requirements

- **Node ≥ 18**: uses the built-in global `fetch` + `AbortSignal.timeout`.
- An `AUDIOLAB_API_KEY`. No ffmpeg, no native dependencies.

## Tools

Every tool takes **one audio source**: a public `url` **or** a local `path`:

- `{ url: "https://…" }`: a public https URL the API fetches server-side.
- `{ path: "./mix.wav" }`: a file on the machine running this server. Files up to **4 MB**
  are sent inline; larger files (up to **50 MB**) upload over a one-shot signed URL, are
  analysed, and are then deleted. *(Local `path` works only in this stdio server, not the
  remote `/mcp` endpoint.)*

| Tool | Returns |
|---|---|
| `analyze_loudness` | Integrated LUFS (EBU R128 / BS.1770-4), true-peak (dBTP), LRA, crest factor, stereo correlation, mono compatibility, tonal balance |
| `check_target` | Pass/fail vs a delivery target (`spotify` / `apple-music` / `youtube` / `tidal` / `amazon-music` / `podcast` / `ebu-broadcast` / `atsc-broadcast`, or `target:"custom"` + `lufs`+`tp`), with per-metric deltas and an ffmpeg loudnorm fix command |
| `analyze_timeseries` | Short-term LUFS over time + downsampled waveform peaks (`waveformPoints?`) |
| `get_spectrum` | FFT magnitude data + 7-band energies |
| `analyze_voice` | Voice QA: speech/silence ratio, speaking rate, SNR, noise floor, room echo, sibilance & clipping risk |
| `get_speech_segments` | Voiced regions with start/end + per-segment RMS (auto-trim, chapters) |
| `index_signal` | Content-type guess, tags, clipping/silence regions, brightness & dynamics buckets |
| `analyze_profile` | One named question, `voice`, `master`, `provenance`, `dataset`, `environment`, `broadcast` or `loop`, answered with only the lenses it needs. These seven need a paid plan; the free tier gets the `basic` profile, keyed by stable lens id. Add `series:true` for the curves, per-block lanes and per-phrase values. Carries a `note` when the profile’s voice lenses land on non-speech material. Full catalogue: <https://audiolab.tools/lenses> |
| `compare_loudness` | A/B on two sources (`urlA`/`pathA` + `urlB`/`pathB`), returns both results |
| `analyze_batch` | One route over up to 20 sources in a single call (`urls` and/or `paths`), per-item ok/data/error. For folder QA, library indexing, or checking a whole release against a target. Each item meters as one call |

Example asks to your AI:

- *“Analyze the loudness of https://example.com/track.wav”* → `analyze_loudness` with `url`
- *“Is this take usable?”* → `analyze_profile` with `profile:"voice"`
- *“Has this file been re-encoded, and is it all one source?”* → `analyze_profile` with `profile:"provenance"`
- *“Run loudness on ./master.wav”* → `analyze_loudness` with `path`
- *“Does ./mix.mp3 pass Spotify?”* → `check_target` with `path` + `target:"spotify"`

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `AUDIOLAB_API_KEY` | – (required) | Your API key. |
| `AUDIOLAB_API_BASE` | `https://audiolab.tools/v1` | Override the API base (must be `https://`). |
| `AUDIOLAB_TIMEOUT_MS` | `330000` | Per-request timeout in milliseconds (long files and batches stream server-side and can legitimately take minutes). |

## Privacy

Analysis happens on the AudioLab API, so the audio **does reach `audiolab.tools`**: a `url`
is fetched server-side, and a local `path` is sent to the API (small files inline; larger
files via a private one-shot signed upload that is deleted right after analysis). The API
returns **numbers only** and does not retain your audio (see https://audiolab.tools/privacy).
This package has no telemetry and writes nothing to disk. If audio must never leave the
machine, don't use a hosted analyser.

## Limits

- Local files: up to **50 MB** (host bigger ones at a public URL).
- Duration: loudness routes (`analyze_loudness`, `check_target`, `analyze_timeseries`, `get_spectrum`) handle **long files** (podcast episodes, full sets, up to ~3 h) via server-side streaming; voice/signal routes are limited to ~7 minutes.
- One file per call (agents loop for many); one-shot (no streaming/realtime).
- Rate and monthly limits are enforced by the API, per key.

## Smoke test

```sh
node hosted-server.mjs --selftest   # verifies the 10 tools + guards; no network
```

## License

MIT © Nathan Renting
