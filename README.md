<!-- Built by scripts/build-public-mcp-repo.mjs in the AudioLab monorepo.
     Edit mcp/README.md there, not this copy. -->

# @audiolabtools/mcp-server

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/audio-launch/audiolab-mcp-server)

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server that gives any
MCP-capable AI (Claude Desktop, Claude Code, Cursor, and others) ten audio-analysis
tools, backed by the hosted **AudioLab** API. It is a thin HTTP client: **no local audio
engine, no ffmpeg, nothing to compile.** It can measure a **public URL** or a **local file**
on your machine, but the measuring always happens on the hosted API: the file is read here
and uploaded there (see [Privacy](#privacy)).

## Install

Point your MCP client at the package via `npx` (nothing to install globally). No account
needed for a first score:

```json
{
  "mcpServers": {
    "audiolab": {
      "command": "npx",
      "args": ["-y", "@audiolabtools/mcp-server"]
    }
  }
}
```

Without a key you are on the **keyless trial**: 20 calls a month and 3 a minute per IP address,
for single analyses of a URL or a local file up to 4 MB. Batches and larger files need a key.
A free key gives 1,000 calls and 2 GB a month, no card: sign in at **https://audiolab.tools/account**,
generate one, and add it:

```json
"env": { "AUDIOLAB_API_KEY": "al_live_yourkey" }
```

## Requirements

- **Node ≥ 18**: uses the built-in global `fetch` + `AbortSignal.timeout`.
- Optionally an `AUDIOLAB_API_KEY` (see Install). No ffmpeg, no native dependencies.

## Tools

Every tool takes **one audio source**: a public `url` **or** a local `path`:

- `{ url: "https://…" }`: a public https URL the API fetches server-side.
- `{ path: "./mix.wav" }`: a file on the machine running this server. Files up to **4 MB**
  are sent inline; larger files (up to **150 MB**) upload over a signed URL, are analysed, and
  are swept from storage within the hour. *(Local `path` works only in this stdio server, not the
  remote `/mcp` endpoint.)*

| Tool | Returns |
|---|---|
| `analyze_loudness` | Integrated LUFS (EBU R128 / BS.1770-4), true-peak (dBTP), LRA, crest factor, stereo correlation, mono compatibility, tonal balance |
| `check_target` | Pass/fail vs a delivery target (`spotify` / `apple-music` / `youtube` / `tidal` / `amazon-music` / `podcast` / `ebu-broadcast` / `atsc-broadcast`, or `target:"custom"` + `lufs`+`tp`), with per-metric deltas; passes within ±0.5 LU of the target with true peak at most 0.5 dB above it. On a fail it adds a single-pass ffmpeg loudnorm command as a starting point: measure the output again, single-pass can miss the margin |
| `analyze_timeseries` | Short-term LUFS over time + downsampled waveform peaks (`waveformPoints?`) |
| `get_spectrum` | FFT magnitude data + 7-band energies |
| `analyze_voice` | Voice QA: speech/silence ratio, speaking rate, SNR, noise floor, pause energy, sibilance & clipping risk |
| `get_speech_segments` | Voiced regions with start/end + per-segment RMS (auto-trim, chapters) |
| `index_signal` | Content-type guess, tags, clipping/silence regions, brightness & dynamics buckets. Add `bandLimit:true` for `bandLimit.upsampled`: `yes`, `no` or `cannot-say`, with the reason in plain words (guide: <https://audiolab.tools/docs/start/is-my-audio-upsampled>) |
| `analyze_profile` | One named question, `voice`, `master`, `provenance`, `dataset`, `environment`, `broadcast`, `loop`, `room` (reverberation from a clap, a pop, an impulse response or a sweep; pass `roomSource`), `chain` (lost packets) or `pitch` (where a voice sits and how clean it is), answered with only the lenses it needs. These ten need a paid plan; the free tier gets the `basic` profile, keyed by stable lens id. Add `series:true` for the curves, per-block lanes and per-phrase values. Add `liveEvents:true` for `liveEvents`: the file read as a stream by the live monitor of /live, with every gap, clipping, level drop, dead air and hum it raised, all with status signals. Carries a `note` when the profile’s voice lenses land on non-speech material. Full catalogue: <https://audiolab.tools/lenses> |
| `compare_loudness` | A/B on two sources (`urlA`/`pathA` + `urlB`/`pathB`), returns both results |
| `analyze_batch` | One route over up to 20 sources in a single call (`urls` and/or `paths`), per-item ok/data/error. For folder QA, library indexing, or checking a whole release against a target; with `endpoint:"signallab/index"` it takes `bandLimit:true` too. Each item meters as one call |

## Options

Every option below is a tool argument. For each: what it is and what it is for, how you
use and read it, and what it is not.

| Option | What it is, what it is for | How to use and read it | What it is not |
|---|---|---|---|
| `measureStatus` | Per field its status (validated, proxy, beta, withdrawn), its basis, and its margin where known, so you know how far to trust each number. | **On by default** since 0.5.3; `false` leaves it out. On `analyze_loudness`, `analyze_voice`, `index_signal`, `analyze_profile`, `compare_loudness`, `analyze_batch`. Validated: state the number, inside its margin. Proxy: compare two recordings, do not state it as a fact. Beta: not shown to be right. Withdrawn: do not read it as what its name says. | Not a guarantee: a margin holds under the conditions on https://audiolab.tools/lenses. Fields that belong to no lens (counts, flags) get no entry. |
| `round` | Numbers rounded to what they are worth: dB and LUFS 2 decimals, seconds 3, ms 1, Hz 1, shares and ratios 3. Fewer tokens, no false precision. | **On by default** since 0.5.3; `false` gives full precision. Same tools as `measureStatus`. Same keys and types. | It makes nothing more accurate. `check_target`, `analyze_timeseries`, `get_spectrum` and `get_speech_segments` are not rounded. |
| `series` | The curves and per-block arrays: short-term loudness, waveform and spectrum (loudness); envelopes, voiced mask, segments and per-segment SNR (voice); curves, lanes and per-phrase values (profile). For your own charts and code. | `series: true`; off by default. On `analyze_loudness`, `analyze_voice`, `analyze_profile`, `analyze_batch`. | Not needed to answer a question, and a large payload. It is not the audio. |
| `speechDetector` | Which detector finds the speech: it decides the speech share, speech and silence time, long silences, segments and the pause measures. `k2` lets a phrase run on into its soft word starts and endings (at most 100 ms per side). | `speechDetector: "k2"`; `v1` is the default until 15 January 2027, then `k2`. On `analyze_voice`, `get_speech_segments`, `analyze_profile`, `analyze_batch`. | It finds when someone speaks, not who and not what: no speaker separation, no transcription. |
| `contentModel` | Which model gives the content type (voice, music, mixed, noise, unknown) and its confidence. `v2` is a small learned model, much better on speech and music in our tests. | `contentModel: "v2"`; `v1` is the default until 15 January 2027, then `v2`. With `v2` the evidence list holds `model:v2`. On `index_signal`, `analyze_profile`, `analyze_batch`. | A classifier, not a measurement. It met its bar for speech and music, not for steady noise, so it is a proxy. |
| `spectrumCalc` | Which spectrum calculation: `v2` corrects three errors found against an independent calculation (spectral roll-off read low; in the profile grid the flatness and the floor of -120 dB). | `spectrumCalc: "v2"`; `v1` is the default until 15 February 2027, then `v2`. On `analyze_loudness`, `get_spectrum`, `analyze_profile`, `compare_loudness`, `analyze_batch`. | Not a different spectrum: some values change a little, keys and types stay the same. |
| `bandLimit` | Whether the audio was upsampled: `bandLimit.upsampled` is `yes`, `no` or `cannot-say`, with its status, reason and basis. | `bandLimit: true` on `index_signal` and `analyze_batch` (`signallab/index`); off by default. Guide: https://audiolab.tools/docs/start/is-my-audio-upsampled | `cannot-say` means look at the file, not that it is fine. A telephone origin is a probability from the bandwidth; it does not name a codec. |
| `liveEvents` | The file read as a stream by the live monitor of /live: every dropout, clipping, level drop, dead air and hum it raised, with times and a reason. | `liveEvents: true` on `analyze_profile` (any profile); off by default. Every event has status `signals`. | Not a diagnosis: none of these detectors has been validated on live streams yet, so say "a signal", never "detected". |
| `roomSource` | How a `room` recording was made: `clap` (default), `balloon`, `impulse` or `sweep`. The room profile measures reverberation per octave band and flutter echo. | With `profile: "room"` on `analyze_profile`. Guide: https://audiolab.tools/docs/voicelab/measure-a-room-with-a-clap | The room profile cannot measure reverberation from speech; an earlier room-echo score was withdrawn. |

Example asks to your AI:

- *“Analyze the loudness of https://example.com/track.wav”* → `analyze_loudness` with `url`
- *“Is this take usable?”* → `analyze_profile` with `profile:"voice"`
- *“Has this file been re-encoded, and is it all one source?”* → `analyze_profile` with `profile:"provenance"`
- *“Which of these recordings were upsampled?”* → `analyze_batch` with `endpoint:"signallab/index"` and `bandLimit:true`
- *“Run loudness on ./master.wav”* → `analyze_loudness` with `path`
- *“Does ./mix.mp3 pass Spotify?”* → `check_target` with `path` + `target:"spotify"`

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `AUDIOLAB_API_KEY` | – (optional) | Your API key. Without it: the keyless trial (20 calls a month per IP, no batches, files up to 4 MB). |
| `AUDIOLAB_API_BASE` | `https://audiolab.tools/v1` | Override the API base (must be `https://`). |
| `AUDIOLAB_TIMEOUT_MS` | `330000` | Per-request timeout in milliseconds (long files and batches stream server-side and can legitimately take minutes). |

## Privacy

Analysis happens on the AudioLab API, so the audio **does reach `audiolab.tools`**: a `url`
is fetched server-side, and a local `path` is read here and uploaded to the API (small
files in the request body; larger files via a private one-shot signed upload into EU
storage). The API returns **numbers only** and does not keep your audio: a direct request
is decoded and discarded inside the request, and a signed upload is swept from storage
within the hour (see https://audiolab.tools/privacy). This package has no telemetry and
writes nothing to disk. There is no offline mode, and the engine is not published as an
installable package. If audio must never leave the machine, don't use a hosted analyser;
the in-browser labs on the website measure on-device, but they are for people, not for
agents.

## Limits

- Local files: up to **150 MB** (host bigger ones at a public URL).
- Duration: loudness routes (`analyze_loudness`, `check_target`, `analyze_timeseries`, `get_spectrum`) handle **long files** (podcast episodes, full sets, up to ~3 h) via server-side streaming; voice/signal routes are limited to ~7 minutes.
- One file per call (agents loop for many); one-shot (no streaming/realtime).
- Rate and monthly limits are enforced by the API, per key (per IP address on the keyless trial).

## Smoke test

```sh
node hosted-server.mjs --selftest   # verifies the 10 tools + guards; no network
```

## License

MIT © Nathan Renting
