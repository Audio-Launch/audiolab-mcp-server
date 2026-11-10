// De foutcodes van AudioLab voor de MCP-servers, met de link naar de uitleg.
//
// De bron is lib/error-codes.mjs in de site-repo (daar staat per code de oorzaak en de oplossing, en daaruit komt de pagina /docs/errors). Dit bestand moet in het npm-pakket zelf zitten,
// want een pakket importeert niets buiten mcp/. scripts/error-docs-check.mjs bewaakt dat de twee lijsten gelijk blijven.

export const DOCS_ERRORS_URL = 'https://audiolab.tools/docs/errors';

export const KNOWN_CODES = [
  'invalid_api_key', 'rate_limited', 'quota_exceeded', 'data_quota_exceeded', 'profile_requires_paid_plan', 'file_too_large', 'track_too_long', 'unsupported_format', 'room_not_measurable', 'incomplete_file',
  'url_not_allowed', 'url_fetch_failed', 'invalid_json', 'missing_input', 'invalid_parameter', 'batch_too_large', 'upload_not_found', 'unknown_endpoint', 'method_not_allowed',
  'storage_unavailable', 'analysis_error', 'missing_api_key', 'api_timeout', 'api_unreachable', 'voice_minutes_exhausted', 'service_paused', 'invalid_input',
];

export const docsUrl = (code) => `${DOCS_ERRORS_URL}#${KNOWN_CODES.includes(code) ? code : 'analysis_error'}`;

/** De code bij een fout: die van de API als hij er is, anders uit de tekst van de fout. Onbekend wordt analysis_error. */
export function codeFor(e) {
  if (e?.code && KNOWN_CODES.includes(e.code)) return e.code;
  const m = String(e?.message || e || '');
  if (/AUDIOLAB_API_KEY is not set/i.test(m)) return 'missing_api_key';
  if (/timed out/i.test(m)) return 'api_timeout';
  if (/Could not reach the AudioLab API/i.test(m)) return 'api_unreachable';
  if (/Upload to storage failed|Could not prepare the upload/i.test(m)) return 'storage_unavailable';
  if (/Batch too large/i.test(m)) return 'batch_too_large';
  if (/Unknown target|AUDIOLAB_API_BASE must/i.test(m)) return 'invalid_parameter';
  if (/file too large|; max \d+(\.\d+)? MB per file/i.test(m)) return 'file_too_large';
  if (/Could not read local file|Local file is empty|Local file paths are only supported|Provide (a url|urls|exactly one)/i.test(m)) return 'invalid_input';
  if (/could not decode|decode failed|Invalid data found/i.test(m)) return 'unsupported_format';
  if (/could not fetch|ENOTFOUND/i.test(m)) return 'url_fetch_failed';
  return 'analysis_error';
}

/** De fouttekst voor een tool-resultaat: de melding zoals hij was, met één regel Docs eronder. */
export const withDocs = (message, e) => `${message}\nDocs: ${docsUrl(codeFor(e))}`;
