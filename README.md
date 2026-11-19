<!-- Built by scripts/build-public-mcp-repo.mjs in the AudioLab monorepo.
     Edit mcp/README.md there, not this copy. -->

# @audiolabtools/mcp-server

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/audio-launch/audiolab-mcp-server)

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server that gives any
MCP-capable AI (Claude Desktop, Claude Code, Cursor, and others) twelve audio-analysis
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
| `check_target` | Pass/fail vs a delivery target (`spotify` / `apple-music` / `youtube` / `tidal` / `amazon-music` / `podcast` / `tiktok` / `instagram` / `soundcloud` / `deezer` / `ebu-broadcast` / `atsc-broadcast`, the slug of a target saved on your account (needs an account key, not the keyless trial), or `target:"custom"` + `lufs`+`tp`), with per-metric deltas; passes within ±0.5 LU of the target with true peak at or under the ceiling. On a fail it adds a single-pass ffmpeg loudnorm command as a starting point: measure the output again, single-pass can miss the margin |
| `analyze_timeseries` | Short-term LUFS over time + downsampled waveform peaks (`waveformPoints?`) |
| `get_spectrum` | FFT magnitude data + 7-band energies |
| `analyze_voice` | Voice QA: speech/silence ratio, speaking rate, SNR, noise floor, pause energy, sibilance & clipping risk |
| `get_speech_segments` | Voiced regions with start/end + per-segment RMS (auto-trim, chapters) |
| `index_signal` | Content-type guess, tags, clipping/silence regions, brightness & dynamics buckets. Add `bandLimit:true` for `bandLimit.upsampled`: `yes`, `no` or `cannot-say`, with the reason in plain words (guide: <https://audiolab.tools/docs/start/is-my-audio-upsampled>) |
| `analyze_profile` | One named question, `voice`, `master`, `provenance`, `dataset`, `environment`, `broadcast`, `loop`, `room` (reverberation from a clap, a pop, an impulse response or a sweep; pass `roomSource`), `chain` (lost packets) or `pitch` (where a voice sits and how clean it is), answered with only the lenses it needs. These ten need a paid plan; the free tier gets the `basic` profile, keyed by stable lens id. Add `series:true` for the curves, per-block lanes and per-phrase values. Add `liveEvents:true` for `liveEvents`: the file read as a stream by the live monitor of /live, with every gap, clipping, level drop, dead air and hum it raised, all with status signals. Carries a `note` when the profile’s voice lenses land on non-speech material. Full catalogue: <https://audiolab.tools/lenses> |
| `compare_loudness` | A/B on two sources (`urlA`/`pathA` + `urlB`/`pathB`), returns both results |
| `analyze_batch` | One route over up to 20 sources in a single call (`urls` and/or `paths`), per-item ok/data/error. For folder QA, library indexing, or checking a whole release against a target; with `endpoint:"signallab/index"` it takes `bandLimit:true` too. Each item meters as one call |
| `get_usage` | Where your key stands this month: plan, period, calls and data used against the limits, requests per minute (`GET /v1/usage`). Needs a key; free to read, does not count as a call |
| `check_qc` | One verdict (pass, warn or fail) against a `spec` (`starting-point` or `target-<preset>`, for example `target-podcast`) or your own `limits` per lens id, rule by rule with each value, its status and margin; optional `critical`. No composite score: a proxy only informs, a value inside its margin gives warn. A local `path` together with `limits` or `critical` goes through the storage upload and so needs a key |

## Options

Each option says what it is and what it is for, how you use and read it, and what it is not.

<!-- options:start (generated from lib/options.mjs by scripts/options-truth-check.mjs --write) -->

Every option, with the lenses it changes: https://audiolab.tools/docs/options

| Option | What it is, what it is for | How to use and read it | What it is not |
|---|---|---|---|
| `measureStatus` | Adds one key, measureStatus, to the answer: for each field that matches a lens, its status (validated, proxy, beta, withdrawn or planned), its method and the lens it belongs to; for a validated lens also its basis; and its margin when the field matches exactly one lens with a margin. A field that matches several lenses gets the weakest status and the list of those lenses. With it you know, per number, whether you may state it, only compare it, or should not use it. | REST: add "measureStatus": true to the JSON body, or ?measureStatus=true with a raw upload. MCP: on by default; measureStatus: false leaves it out. Read it per field: validated, state the number and stay inside its margin; proxy, use it to compare two recordings, not as a fact; beta, not shown to be right yet; withdrawn, do not read it as what its name says. MCP default: true (since MCP server 0.5.3). | Not a guarantee for your recording: a margin holds under the conditions named on the lens. A field that matches no lens gets no entry. It does not remove a withdrawn field: that stays in the answer so that nothing breaks. |
| `round` | Rounds the numbers to what they are worth: dB, dBFS, dBTP, LUFS, LU and dB/s to 2 decimals, seconds to 3, milliseconds to 1, Hz to 1, shares and ratios to 3, other numbers to 7 significant digits, and numbers in an array to 6 significant digits. Whole numbers stay as they are. On analyze/profile the lenses are rounded, not the other keys. The keys and types stay the same. | REST: "round": true. MCP: on by default; round: false gives full precision. Combine it with measureStatus: the margin of a lens says how many of the remaining digits mean something. MCP default: true (since MCP server 0.5.3). | It makes nothing more accurate: the measurement is the same, only the digits are fewer. Only mixlab/analyze, voicelab/qa, signallab and analyze/profile are rounded (and signallab/index in a batch); the other routes keep full precision. |
| `series` | Puts the curves and arrays back in the answer: on mixlab/analyze the short-term loudness, the waveform and the spectrum; on voicelab/qa the level envelope, the voiced mask, the segments and the signal-to-noise per segment; on signallab the regions and the energy and centroid envelopes; on analyze/profile every lens that is a curve, a matrix, or a value per block or per segment, among them the octave bands of the room profile. | REST and MCP: series: true; off by default, and then the answer says series: false where the arrays were. In analyze_batch it applies to every item. MCP default: false. | Not needed to answer a question, and it can make the answer many times larger. It is not the audio. |
| `speechDetector` | Chooses the detector that finds the speech. It decides speechRatio, speechSec, silenceSec, longSilences, the segments, the voiced mask and the measures that read the pauses or the speech, such as the speech level and the signal-to-noise ratio (k2 corrects that ratio below 16 dB). k2 lets a phrase run on into its soft word starts and endings, by at most 100 ms per side. | REST and MCP: "speechDetector": "k2". Leave it out to get the default: v1 until 15 January 2027, then k2. /v1/qc is the one exception: it measures the voice with k2 unless you send "v1", so its verdict matches the QC view in the browser. The keys are the same with both; a pause measure is null when no pause is left. MCP default: the API default. | It finds when someone speaks, not who (no speaker separation) and not what (no transcription). Most of the lenses it decides are proxies; the signal-to-noise ratio is validated. |
| `contentModel` | Chooses the model that gives the content type (voice, music, mixed, noise, silence or unknown) and its confidence. v2 is a small learned model over 25 simple features per 10-second window, much better on speech and music in our tests. | REST and MCP: "contentModel": "v2". Leave it out to get the default: v1 until 15 January 2027, then v2. With v2 the evidence list contains model:v2, so you can see which model answered. MCP default: the API default. | A classifier, not a measurement. v2 met its bar for speech and music, not for steady noise (street traffic and the metro mostly read unknown), so the content type stays a proxy. |
| `spectrumCalc` | Chooses the spectrum calculation. v2 corrects three errors found in a test against an independent calculation of the same definitions (MARGES-5): the spectral roll-off no longer counts the DC bin (v1 reads it low), and in the analysis grid of analyze/profile the flatness divides by the bins it uses and a level under -120 dB reads -120 (that reaches the level, peak, crest and noise floor of each block, and the headroom). The grid values per block come with series. | REST and MCP: "spectrumCalc": "v2". Leave it out to get the default: v1 until 15 February 2027, then v2. The keys and types are the same with both. MCP default: the API default. | Not a different spectrum: a few values change a little. It changes nothing in loudness or true peak. |
| `bandLimit` | Adds bandLimit: whether the audio was upsampled, as upsampled yes, no or cannot-say, with its status, its reason in plain words and its basis. | REST: "bandLimit": true on signallab. MCP: bandLimit: true on index_signal, or on analyze_batch with endpoint signallab/index. yes rests on a validated rule (the band stops under 5 kHz in a file of 16 kHz or more); no and the bandwidth ratio are proxies. In the provenance and dataset profiles of analyze/profile the verdict is always there, without this option. MCP default: false. | cannot-say means: look at the file, not that it is fine. telephonyOrigin, a validated rule on the same bandwidth, says a file probably passed through an 8 kHz telephone channel; it does not name a codec. |
| `liveEvents` | Adds liveEvents: the file read as a stream, 20 ms at a time, by the same live monitor as /live and the npm package @audiolabtools/live, with every dropout, clipping, level drop, dead air and hum event it raised, with its times and its reason. | REST and MCP: "liveEvents": true on analyze/profile, with any profile. Every event has status signals: say "a signal", never "detected". MCP default: false. | Not a diagnosis: none of these detectors has been validated on live streams yet. A dropout or clipping event uses its own rule and can differ from chain.dropoutCount and signal.clipping in the same answer; the event says why. |
| `roomSource` | Tells the room profile how the recording was made: one clap, one balloon pop, an impulse response, or the engine's sweep as the room returned it. The room profile measures how long the room rings and whether there is a flutter echo; the values per octave band come with series. | REST and MCP: "profile": "room" with "roomSource" on analyze/profile. The room profile needs a paid plan. MCP default: the API default. | It cannot measure reverberation from speech or music: it needs one of the four sources. An earlier room-echo score was withdrawn because it was not a reverb measure. |

<!-- options:end -->

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
node hosted-server.mjs --selftest   # verifies the 12 tools + guards; no network
```

## License

MIT © Nathan Renting
