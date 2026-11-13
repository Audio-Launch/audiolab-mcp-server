#!/usr/bin/env node
// AudioLab HOSTED-mode MCP server. Exposes the 10 AudioLab tools to any MCP-capable
// AI (Claude Desktop / Claude Code, Cursor, etc.) by calling the hosted API at
// audiolab.tools/v1/*. It contains NO engine code, just HTTP calls, so it is safe to
// distribute publicly without exposing the proprietary engine.
//
// Two consumers share buildServer():
//   1. This file run directly = a stdio server (the npm package @audiolabtools/mcp-server),
//      reading the key from AUDIOLAB_API_KEY. Started with { local: true }, so it can also
//      analyse a LOCAL file via `{ path }` (small files POST raw; larger files are PUT to
//      storage via a signed URL and analysed by objectPath). Nothing is exposed publicly.
//   2. api/mcp.mjs = the remote streamable-HTTP endpoint at /mcp, which passes the
//      per-request Bearer key via buildServer({ apiKey }). local defaults to FALSE there,
//      a remote server must NEVER read a path off its own filesystem, so `{ path }` is
//      rejected and only `{ url }` is accepted.
//
// Works without a key since 0.5.0 (27 Oct 2026): single analyses of a URL or a local file up to 4 MB go out
// without an Authorization header and land on the API's keyless trial (20 calls a month, 3 a minute, per IP),
// the same as a curl without a key. Batches and larger files need a key, because /v1/batch and the storage
// upload are tied to one. A free key (sign in at https://audiolab.tools/account) gives 1,000 calls a month.
// Config in Claude Desktop's claude_desktop_config.json:
//   { "mcpServers": { "audiolab": {
//       "command": "npx", "args": ["-y", "@audiolabtools/mcp-server"],
//       "env": { "AUDIOLAB_API_KEY": "al_live_yourkey" } } } }
//
// Env: AUDIOLAB_API_KEY (optional in stdio mode, see above), AUDIOLAB_API_BASE
// (default https://audiolab.tools/v1, must be https), AUDIOLAB_TIMEOUT_MS (default 330000).
// Smoke test (no network): node hosted-server.mjs --selftest

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { withDocs } from './error-docs.mjs';

// The version reported over MCP used to be a literal with a "keep in sync with
// package.json" comment next to it. It drifted anyway: the package shipped 0.3.1
// while every initialize response still announced 0.3.0. Read it instead, so the
// comment cannot be ignored and the two cannot disagree.
// ponytail: the npm package always ships package.json, the Vercel bundle of api/mcp.mjs
// never does (includeFiles skips it too). A throw here took the remote /mcp down at load
// time from 11 Aug to 14 Sep, so the hosted copy reports 'hosted' instead of crashing.
const PKG_VERSION = (() => {
  try { return createRequire(import.meta.url)('./package.json').version; } catch { return 'hosted'; }
})();

// Vercel serverless caps a raw request body at ~4.5 MB, so small files POST directly and
// larger ones go through the signed-URL storage flow. The bucket policy caps at 150 MB.
const RAW_MAX = 4 * 1024 * 1024;
// Dit bestand is het ENIGE dat npm meestuurt, dus het mag niets buiten zijn eigen map
// importeren. `MAX_STORAGE_BYTES` uit ../lib/limits.mjs stond hier even, en daarmee
// crashte het gepubliceerde pakket bij de eerste import: die map wordt niet meegeleverd.
// De waarde staat daarom weer hier, en de zelfcheck hieronder houdt hem tegen limits.mjs aan
// zolang die bereikbaar is, dus in de monorepo faalt drift alsnog.
const STORAGE_MAX = 150 * 1024 * 1024;

// Read env at CALL time (not module load) so the key can be injected by the MCP host
// and so the missing-key guard is testable.
const apiBase = () => {
  const base = (process.env.AUDIOLAB_API_BASE || 'https://audiolab.tools/v1').replace(/\/$/, '');
  // Defense in depth: never send the Bearer key over a non-https (or attacker-injected) base.
  if (!/^https:\/\//i.test(base)) throw new Error('AUDIOLAB_API_BASE must be an https:// URL.');
  return base;
};

// Just above the API's own 300 s ceiling: since long files stream server-side
// (a 25-min track ≈ 10-30 s, batches of them add up), a 60 s client default
// made the client give up while the server was still happily working.
const timeoutMs = () => Number(process.env.AUDIOLAB_TIMEOUT_MS) || 330_000;

// The key if there is one. Without one, single analyses go to the keyless trial; the remote /mcp endpoint
// always passes a key (api/mcp.mjs refuses a request without one before it gets here).
const keyOf = (key) => key || process.env.AUDIOLAB_API_KEY || null;
const auth = (k) => (k ? { authorization: `Bearer ${k}` } : {});

// Batches and the storage upload are tied to a key server-side, so these refuse before any network call.
function requireKey(key, what) {
  const k = keyOf(key);
  if (!k) throw new Error(`AUDIOLAB_API_KEY is not set. ${what} need a key; a free one gives 1,000 calls a month: https://audiolab.tools/account. Single files up to 4 MB and URLs work without one.`);
  return k;
}

// Guess an audio content-type from a filename extension.
const CT_BY_EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', webm: 'audio/webm', aiff: 'audio/aiff', aif: 'audio/aiff' };
const ctForPath = (p) => CT_BY_EXT[String(p).split('.').pop()?.toLowerCase()] || 'application/octet-stream';

// Low-level JSON request with a hard timeout. Never echoes an arbitrary upstream body.
async function request(url, { method = 'POST', headers = {}, body } = {}) {
  const ms = timeoutMs();
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`AudioLab API timed out after ${ms} ms.`);
    throw new Error(`Could not reach the AudioLab API: ${String(e?.message || e)}`);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(res.ok ? 'AudioLab API returned a non-JSON response.' : `AudioLab API error ${res.status}.`); }
  if (!res.ok) {
    const err = new Error(String(json?.error?.message || json?.error || `API returned ${res.status}`));
    if (json?.error?.code) err.code = json.error.code; // de vaste foutcode van de API; error-docs.mjs maakt er de Docs-regel van
    throw err;
  }
  return json;
}

// key defaults to the env var (stdio mode); the remote endpoint passes a per-request key.
export async function call(route, body, key = process.env.AUDIOLAB_API_KEY) {
  return request(`${apiBase()}/${route}`, {
    headers: { 'content-type': 'application/json', ...auth(keyOf(key)) },
    body: JSON.stringify(body),
  });
}

// Small local file → raw audio body straight to /v1 (fast, no storage round-trip).
// Tool extras (target/lufs/tp/waveformPoints/fileName) ride along as query params.
async function postRaw(route, buf, ct, extra, key) {
  const qs = new URLSearchParams();
  for (const [name, v] of Object.entries(extra || {})) if (v !== undefined && v !== null && v !== '') qs.set(name, String(v));
  const q = qs.toString();
  return request(`${apiBase()}/${route}${q ? `?${q}` : ''}`, {
    headers: { 'content-type': ct, ...auth(keyOf(key)) },
    body: buf,
  });
}

// Mint a signed upload URL and PUT the bytes to storage; returns the objectPath.
// The objectPath is namespaced to this key server-side; only this key can read it.
async function uploadToStorage(buf, ct, key) {
  const k = requireKey(key, 'Files over 4 MB');
  const origin = new URL(apiBase()).origin;
  const mint = await request(`${origin}/api/upload-url`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` },
    body: JSON.stringify({ contentType: ct, size: buf.length }),
  });
  if (!mint?.signedUrl || !mint?.objectPath) throw new Error('Could not prepare the upload.');
  let put;
  try {
    put = await fetch(mint.signedUrl, { method: 'PUT', headers: { 'content-type': ct }, body: buf, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`Upload timed out after ${timeoutMs()} ms.`);
    throw new Error(`Upload to storage failed: ${String(e?.message || e)}`);
  }
  if (!put.ok) throw new Error(`Upload to storage failed (HTTP ${put.status}).`);
  return mint.objectPath;
}

// Larger local file → upload to storage, then analyse by objectPath.
async function postUpload(route, buf, ct, fileName, extra, key) {
  const objectPath = await uploadToStorage(buf, ct, key);
  return call(route, { objectPath, fileName, ...extra }, key);
}

// Read + size-check one local file for upload flows.
async function readLocal(p) {
  let buf;
  try { buf = await readFile(p); }
  catch (e) { throw new Error(`Could not read local file "${p}": ${e?.code || e?.message || e}`); }
  if (!buf.length) throw new Error(`Local file is empty: "${p}".`);
  if (buf.length > STORAGE_MAX) throw new Error(`"${p}" is ${(buf.length / 1048576).toFixed(1)} MB; max ${STORAGE_MAX / 1048576} MB per file. Host it at a public https URL instead.`);
  return buf;
}

// Batch: one analysis route over many sources in a single /v1/batch call.
// Local paths are uploaded to storage first (one-shot signed URLs), then the
// whole set goes out as ONE call with urls + objectPaths. Max 20 combined,
// matching the server-side cap; each item is metered as one call server-side.
const BATCH_MAX = 20;
async function batchSources({ urls = [], paths = [] }, endpoint, extra, key, local = false) {
  if (paths.length && !local) throw new Error('Local file paths are only supported by the local (stdio) MCP server; use public https urls instead.');
  const total = urls.length + paths.length;
  if (!total) throw new Error('Provide urls (public https) and/or paths (local files).');
  if (total > BATCH_MAX) throw new Error(`Batch too large: max ${BATCH_MAX} items per call. Split into smaller batches.`);
  requireKey(key, 'Batches');
  const objectPaths = [];
  for (const p of paths) {
    const buf = await readLocal(p);
    objectPaths.push(await uploadToStorage(buf, ctForPath(p), key));
  }
  const args = Object.fromEntries(Object.entries(extra || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const body = { endpoint };
  if (urls.length) body.urls = urls;
  if (objectPaths.length) body.objectPaths = objectPaths;
  if (Object.keys(args).length) body.args = args;
  return call('batch', body, key);
}

// Resolve one audio source (url OR local path) to a route call. `local` gates path reads:
// the remote /mcp endpoint passes local=false and must NEVER touch the server filesystem.
async function analyzeSource(route, { url, path } = {}, extra = {}, key, local = false) {
  if (url && path) throw new Error('Provide exactly one of url or path, not both.');
  if (path) {
    if (!local) throw new Error('Local file paths are only supported by the local (stdio) MCP server; use a public https url instead.');
    let buf;
    try { buf = await readFile(path); }
    catch (e) { throw new Error(`Could not read local file "${path}": ${e?.code || e?.message || e}`); }
    if (!buf.length) throw new Error('Local file is empty.');
    if (buf.length > STORAGE_MAX) throw new Error(`Local file is ${(buf.length / 1048576).toFixed(1)} MB; max ${STORAGE_MAX / 1048576} MB. Host it at a public https URL for larger files.`);
    const name = basename(path);
    const ct = ctForPath(path);
    return buf.length <= RAW_MAX
      ? postRaw(route, buf, ct, { ...extra, fileName: name }, key)  // small → raw POST (no storage)
      : postUpload(route, buf, ct, name, extra, key);              // large → signed-URL upload
  }
  if (url) return call(route, { url, ...extra }, key);
  throw new Error('Provide a url (public https) or a path (local file).');
}

const asContent = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const wrap = (fn) => async (input) => {
  try { return asContent(await fn(input)); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: withDocs(String(e?.message || e), e) }] }; }
};

// Input source shape. Remote (url-only) keeps the original required url; local adds an
// optional path (exactly one of the two). Local-file support only exists in stdio mode.
const sourceShape = (local) => local
  ? {
      url: z.string().url().optional().describe('Public https URL to the audio file. Provide exactly one of url or path.'),
      path: z.string().optional().describe('Path to a LOCAL audio file on this machine. It is read here and uploaded to the AudioLab API for measuring, so you do not need to host it publicly (files up to 4 MB go in the request body; larger ones, up to 150 MB, upload over a signed URL and are swept from storage within the hour). Provide exactly one of url or path.'),
    }
  : { url: z.string().url().describe('Public https URL to the audio file.') };

export function buildServer({ apiKey, local = false } = {}) {
  const server = new McpServer({ name: 'audiolab', version: PKG_VERSION });
  const toolNames = [];
  const tool = (name, def, handler) => { server.registerTool(name, def, handler); toolNames.push(name); };
  const src = sourceShape(local);
  const srcDoc = local ? ' Audio source: a public https URL, or a local file path (`path`).' : ' Audio source: public https URL.';

  tool('analyze_loudness', {
    title: 'Analyze loudness (MixLab)',
    description: 'Loudness and dynamics for a track: integrated LUFS (EBU R128 / BS.1770-4), true-peak (dBTP), loudness range (LRA), crest factor, stereo correlation, mono compatibility, and tonal balance.' + srcDoc,
    inputSchema: src,
  }, wrap((i) => analyzeSource('mixlab/analyze', i, {}, apiKey, local)));

  tool('check_target', {
    title: 'Check audio against a loudness target (Spotify, EBU, etc.)',
    description: 'Verify whether audio hits a delivery target (Spotify -14 LUFS / EBU broadcast -23 / podcast -16 / etc.). Returns pass/fail with per-metric deltas and a concrete ffmpeg loudnorm command to fix if failing. Presets: spotify, apple-music, youtube, tidal, amazon-music, podcast, ebu-broadcast, atsc-broadcast; or target="custom" with lufs+tp.' + srcDoc,
    inputSchema: { ...src, target: z.string().describe('Preset id or "custom".'), lufs: z.number().optional(), tp: z.number().optional() },
  }, wrap((i) => analyzeSource('mixlab/check-target', i, { target: i.target, lufs: i.lufs, tp: i.tp }, apiKey, local)));

  tool('analyze_timeseries', {
    title: 'Loudness over time (for graphing / visualization)',
    description: 'Short-term LUFS samples over time (EBU R128, ~3s window) with their time-base, plus downsampled waveform peaks. Arrays suitable for loudness-over-time charts, level meters, and waveform UIs.' + srcDoc,
    inputSchema: { ...src, waveformPoints: z.number().int().positive().optional().describe('Waveform peak count (default 200).') },
  }, wrap((i) => analyzeSource('mixlab/timeseries', i, { waveformPoints: i.waveformPoints }, apiKey, local)));

  tool('get_spectrum', {
    title: 'FFT spectrum data',
    description: 'Frequency-domain magnitude data (paired frequency/magnitude arrays) plus energies in 7 standard bands (sub/bass/lowMid/mid/highMid/presence/air). There is no dominant-band field in the response. For spectrum-analyzer UIs and tonal-balance analysis.' + srcDoc,
    inputSchema: src,
  }, wrap((i) => analyzeSource('mixlab/spectrum', i, {}, apiKey, local)));

  tool('analyze_voice', {
    title: 'Analyze voice quality (VoiceLab)',
    description: 'Speech-quality QA for a voice recording: speech/silence ratio, speaking-rate label, signal-to-noise, noise floor, pause energy, sibilance risk, clipping severity. Gates a voice take. Status: levels, SNR, noise floor and clipping are validated against known signals; speaking rate, background scene and intelligibility are proxies, and the pause-energy field is not a reverb measure (https://audiolab.tools/lenses).' + srcDoc,
    inputSchema: src,
  }, wrap((i) => analyzeSource('voicelab/qa', i, {}, apiKey, local)));

  tool('get_speech_segments', {
    title: 'Speech segments (VoiceLab)',
    description: 'List voiced speech regions with start/end timestamps and per-segment RMS. For auto-trim and chapter generation. RMS-based voice-activity detection: it finds where speech is, not who is speaking, and it does not detect speaker turns. Status: a proxy, the speech gate is not measured against labelled speech.' + srcDoc,
    inputSchema: src,
  }, wrap((i) => analyzeSource('voicelab/segments', i, {}, apiKey, local)));

  tool('index_signal', {
    title: 'Index a signal (SignalLab)',
    description: 'A metadata index for any audio file: content-type guess (voice/music/mixed/noise/silence) with confidence, brightness & dynamics buckets, a rough band label, clipping/silence regions, and tag suggestions. For triage or auto-tagging a library. Status: content type, regions and confidence come from a frame classifier that is a proxy, not validated on a labelled corpus of real recordings; the tags describe the signal only, never the speaker (https://audiolab.tools/lenses). Set bandLimit:true to ask whether the audio was upsampled: bandLimit.upsampled is yes, no or cannot-say, with the reason in plain words. yes rests on a validated rule (study UP-1: the band stops under 5 kHz in a file of 16 kHz or more, as after a telephone call); no and the bandwidth ratio are proxies (study UP-2); cannot-say means look at the file, not that it is fine.' + srcDoc,
    inputSchema: {
      ...src,
      bandLimit: z.boolean().optional().describe('Also return bandLimit: whether the audio was upsampled (yes, no or cannot-say), its status, reason and basis. Off by default.'),
    },
  }, wrap((i) => analyzeSource('signallab', i, { bandLimit: i.bandLimit }, apiKey, local)));

  // analyze_profile: the lens registry as one tool. A model that knows what it
  // is looking for names the question, not forty field names; a model that does
  // not can read the profiles here and pick one.
  tool('analyze_profile', {
    title: 'Analyse against a profile',
    description:
      'Measure a file against a named working set of lenses and get back only what that question needs. '
      + 'Profiles: voice (is this take usable, and which phrase is the problem), '
      + 'master (will this translate to real platforms and speakers), '
      + 'provenance (what has been done to this file, and is it all one source), '
      + 'dataset (which of these files are good enough, and why not the rest), '
      + 'environment (what is in this space, and what kind of noise is it), '
      + 'broadcast (does this file meet the delivery spec), '
      + 'loop (is this loop clean, on the grid, and safe to drop in a DAW), '
      + 'room (how long does this room ring per octave band, and is there a flutter echo; needs a recording of one clap, a balloon pop, an impulse response or a sweep), '
      + 'chain (did this recording lose packets on its way: gaps of digital silence), '
      + 'pitch (where does this voice sit, how much does it move, how clean is it). '
      + 'basic is the free tier; the other ten need a paid plan. '
      + 'Results are keyed by stable lens id. Only the analysis passes the profile needs are run. '
      + 'Set series:true to also get the curves, the per-block lanes and the per-phrase values,'
      + 'a much larger payload, so leave it off unless you are going to read them. '
      + 'Set liveEvents:true to also get liveEvents: the file read as a stream by the live monitor, with every dropout, clipping, level drop, dead air '
      + 'and hum event, its times and its reason. Status signals: none of these detectors has been validated on live streams yet, so say "a signal", '
      + 'never "detected". A dropout or clipping event names the file measure with its own rule (chain.dropoutCount, signal.clipping) and why the two can differ.'
      + srcDoc,
    inputSchema: {
      ...src,
      profile: z.enum(['basic', 'voice', 'master', 'provenance', 'dataset', 'environment', 'broadcast', 'loop', 'room', 'chain', 'pitch'])
        .describe('Which question to answer.'),
      series: z.boolean().optional()
        .describe('Include time series, per-block lanes and per-phrase arrays. Off by default.'),
      roomSource: z.enum(['clap', 'balloon', 'impulse', 'sweep']).optional()
        .describe('For the room profile: how the recording was made. clap (default): one clap; balloon: one pop; impulse: the file is an impulse response; sweep: the file holds the sweep of the engine as the room returned it.'),
      liveEvents: z.boolean().optional()
        .describe('Also return liveEvents: the events of the live monitor over the whole file, status signals. Off by default.'),
    },
  }, wrap((i) => analyzeSource('analyze/profile', i, { profile: i.profile, series: i.series === true, ...(i.roomSource ? { roomSource: i.roomSource } : {}), ...(i.liveEvents ? { liveEvents: true } : {}) }, apiKey, local)));

  // compare_loudness: two independent sources, each a url or (local only) a path.
  const cmp = local
    ? {
        urlA: z.string().url().optional().describe('First source URL (e.g. master). Provide urlA or pathA.'),
        pathA: z.string().optional().describe('First source as a local file path.'),
        urlB: z.string().url().optional().describe('Second source URL (e.g. reference). Provide urlB or pathB.'),
        pathB: z.string().optional().describe('Second source as a local file path.'),
      }
    : {
        urlA: z.string().url().describe('First source (e.g. master).'),
        urlB: z.string().url().describe('Second source (e.g. reference).'),
      };
  tool('compare_loudness', {
    title: 'Compare two tracks (A/B)',
    description: 'Run loudness analysis on TWO sources and return both results for an A/B comparison: master vs reference, before vs after a fix, two encoders, two cuts.' + srcDoc,
    inputSchema: cmp,
  }, wrap(async (i) => {
    const [a, b] = await Promise.all([
      analyzeSource('mixlab/analyze', { url: i.urlA, path: i.pathA }, {}, apiKey, local),
      analyzeSource('mixlab/analyze', { url: i.urlB, path: i.pathB }, {}, apiKey, local),
    ]);
    return { a, b };
  }));

  // analyze_batch: one route over many sources, a single metered-per-item call.
  const batchSrc = local
    ? {
        urls: z.array(z.string().url()).optional().describe('Public https URLs to audio files. Combined max 20 items with paths.'),
        paths: z.array(z.string()).optional().describe('LOCAL audio file paths; each is read here and uploaded over a one-shot signed URL, measured by the API, and swept from storage within the hour. Combined max 20 items with urls.'),
      }
    : { urls: z.array(z.string().url()).min(1).max(20).describe('Public https URLs to audio files (max 20).') };
  tool('analyze_batch', {
    title: 'Batch: one analysis route over many files',
    description: 'Run one analysis route over up to 20 audio sources in a single call. Returns per-item ok/data/error; each item is metered as one call. Routes: mixlab/analyze (default), mixlab/check-target, mixlab/timeseries, mixlab/spectrum, voicelab/qa, voicelab/segments, signallab/index. Use for folder QA, library indexing, or checking a whole release against a loudness target.' + (local ? ' Sources: public https urls and/or local file paths.' : ' Sources: public https urls.'),
    inputSchema: {
      ...batchSrc,
      endpoint: z.string().optional().describe('Analysis route to run for every item (default mixlab/analyze).'),
      target: z.string().optional().describe('For mixlab/check-target: preset id (spotify, ebu-broadcast, podcast, …) or "custom".'),
      lufs: z.number().optional().describe('For target="custom": integrated LUFS target.'),
      tp: z.number().optional().describe('For target="custom": max true-peak (dBTP).'),
      bandLimit: z.boolean().optional().describe('For signallab/index: also return bandLimit per file, with upsampled yes, no or cannot-say (see index_signal).'),
    },
  }, wrap((i) => batchSources({ urls: i.urls || [], paths: i.paths || [] }, i.endpoint || 'mixlab/analyze', { target: i.target, lufs: i.lufs, tp: i.tp, bandLimit: i.bandLimit }, apiKey, local)));

  return { server, toolNames };
}

// Run as a stdio server ONLY when executed directly. Importing this module (api/mcp.mjs)
// is side-effect-free so it can reuse buildServer() without opening a stdio transport.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain && process.argv.includes('--selftest')) {
  const assert = (await import('node:assert/strict')).default;
  const expected = ['analyze_batch', 'analyze_loudness', 'analyze_profile', 'analyze_timeseries', 'analyze_voice', 'check_target', 'compare_loudness', 'get_spectrum', 'get_speech_segments', 'index_signal'];
  assert.deepEqual(buildServer().toolNames.slice().sort(), expected, 'ten hosted tools (remote / url-only)');
  assert.deepEqual(buildServer({ local: true }).toolNames.slice().sort(), expected, 'ten hosted tools (local / url+path)');

  const prev = process.env.AUDIOLAB_API_KEY;
  delete process.env.AUDIOLAB_API_KEY;
  // Without a key: a single analysis goes out with no Authorization header (the keyless trial); a batch refuses before any fetch.
  {
    const realFetch = globalThis.fetch;
    let sent;
    globalThis.fetch = async (_url, init) => { sent = init.headers; return new Response('{"ok":true}', { status: 200 }); };
    try {
      await call('mixlab/analyze', { url: 'https://example.com/a.wav' });
      assert.ok(sent && !('authorization' in sent), 'keyless call sends no Authorization header');
      await call('mixlab/analyze', { url: 'https://example.com/a.wav' }, 'al_live_selftest');
      assert.equal(sent.authorization, 'Bearer al_live_selftest', 'a key still goes out as Bearer');
      sent = undefined;
      await assert.rejects(() => batchSources({ urls: ['https://example.com/a.wav'] }, 'mixlab/analyze', {}, undefined, false), /AUDIOLAB_API_KEY is not set\. Batches need a key/, 'batch refuses without a key');
      assert.equal(sent, undefined, 'the batch refusal happens before any fetch');
    } finally { globalThis.fetch = realFetch; }
  }

  // Elke fout die de gebruiker te zien krijgt draagt één regel Docs met een vaste code (mcp/error-docs.mjs; de uitleg staat op /docs/errors).
  {
    const { withDocs, codeFor } = await import('./error-docs.mjs');
    assert.equal(withDocs('AUDIOLAB_API_KEY is not set.', new Error('AUDIOLAB_API_KEY is not set. Get a key at https://audiolab.tools/account.')), 'AUDIOLAB_API_KEY is not set.\nDocs: https://audiolab.tools/docs/errors#missing_api_key', 'de ontbrekende sleutel wijst naar zijn uitleg');
    assert.equal(codeFor(Object.assign(new Error('x'), { code: 'quota_exceeded' })), 'quota_exceeded', 'de code van de API wint van de tekst');
    assert.equal(codeFor(new Error('iets onverwachts')), 'analysis_error', 'onbekend valt terug op analysis_error');
    assert.equal(codeFor(new Error('AudioLab API timed out after 5 ms.')), 'api_timeout');
  }

  process.env.AUDIOLAB_API_KEY = 'al_live_selftest';
  // A remote server (local=false) must refuse a path BEFORE any filesystem read.
  await assert.rejects(() => analyzeSource('mixlab/analyze', { path: '/etc/hostname' }, {}, 'al_live_selftest', false), /only supported by the local/, 'remote MCP never reads a server-side path');
  // url + path together is a usage error.
  await assert.rejects(() => analyzeSource('mixlab/analyze', { url: 'https://x/a.wav', path: '/tmp/a.wav' }, {}, 'al_live_selftest', true), /exactly one/, 'url+path together rejected');
  // Batch guards fire BEFORE any network or filesystem work.
  await assert.rejects(() => batchSources({ paths: ['/tmp/a.wav'] }, 'mixlab/analyze', {}, 'al_live_selftest', false), /only supported by the local/, 'remote batch never reads server-side paths');
  await assert.rejects(() => batchSources({ urls: [], paths: [] }, 'mixlab/analyze', {}, 'al_live_selftest', true), /Provide urls/, 'empty batch rejected');
  await assert.rejects(() => batchSources({ urls: Array.from({ length: 21 }, (_, n) => `https://x/${n}.wav`) }, 'mixlab/analyze', {}, 'al_live_selftest', false), /max 20/, 'oversized batch rejected before network');
  if (prev) process.env.AUDIOLAB_API_KEY = prev; else delete process.env.AUDIOLAB_API_KEY;

  // The version announced over MCP drifted from the published package once already
  // (server said 0.3.0, npm had 0.3.1). Now it is read from package.json, and this
  // asserts the read actually resolved rather than silently yielding undefined.
  assert.equal(typeof PKG_VERSION, 'string', 'version resolves from package.json');
  assert.match(PKG_VERSION, /^\d+\.\d+\.\d+/, 'version looks like a semver');

  // De opslaggrens staat hier hardgecodeerd omdat het pakket zichzelf moet kunnen draaien.
  // In de monorepo is limits.mjs er wel, en dan moet hij gelijk zijn; in het gepubliceerde
  // pakket ontbreekt hij en slaan we over. Zo kan de waarde niet stil uit elkaar lopen.
  try {
    const { MAX_STORAGE_BYTES } = await import('../lib/limits.mjs');
    assert.equal(STORAGE_MAX, MAX_STORAGE_BYTES, 'STORAGE_MAX loopt uit de pas met lib/limits.mjs');
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }

  console.log(`selftest ok · v${PKG_VERSION} · ${expected.length} tools (incl. analyze_profile) + keyless trial and batch-key guard + remote-path refusals + batch guards`);
  process.exit(0);
}

if (isMain) {
  const { server } = buildServer({ local: true });
  await server.connect(new StdioServerTransport());
}
