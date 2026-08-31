import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CANDIDATE_VERSIONS, DATASET_ID, DomainError, LIMITS, OWNER_IDS, PROTOCOL, TASK_IDS, TICKET_IDS, type ClientClass, type SessionRef } from '../shared/contract';
import { DATASET_DIGEST } from '../shared/canonical';
import { OWNERS, TASKS, TICKETS } from '../shared/fixture';
import { ACTION_ENVELOPE_SCHEMA, ACTION_SCHEMAS, ACTION_TYPES, CREATE_REQUEST_SCHEMA, SESSION_SCHEMA, UUID_PATTERN, parseActionEnvelope, parseCreateRequest, parseSessionDocument, parseSessionRef } from '../shared/validate';
import { createRepository, type RepositoryOptions } from './repository';
import { authorizeMode, availableActions, inspectState } from './policy';
import { exportMarkdown, exportSession, exportUninterpreted, exportUninterpretedMarkdown } from './export';

export interface AppOptions extends RepositoryOptions { port: number; nonce?: string }
export interface App { fetch(request: Request): Promise<Response>; close(): Promise<void> }
interface StaticAsset { path: string; contentType: string; text: string | null }
const PROJECT_ROOT = resolve(import.meta.dir, '..');
const WEB_ROOT = join(PROJECT_ROOT, 'web');
const BUILD_ROOT = join(PROJECT_ROOT, '.build');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
};
const ERROR_CODES = {
  VALIDATION_ERROR: 'Malformed, unknown, or out-of-bounds input.', BODY_TOO_LARGE: 'Request exceeds 32768 bytes.',
  FORBIDDEN_HOST: 'Expected the exact loopback host and port.', FORBIDDEN_ORIGIN: 'Foreign Origin or cross-site request.',
  FORBIDDEN_ACTOR: 'Client class does not have this capability.', INVALID_NONCE: 'Discover again after a server restart.',
  UNSUPPORTED_MEDIA_TYPE: 'Mutations require application/json.', MODE_UNAVAILABLE: 'Mode is disabled by the server configuration.',
  NOT_FOUND: 'No allowlisted route or session.', METHOD_NOT_ALLOWED: 'Unsupported HTTP method.',
  STALE_REVISION: 'The session or pane changed.', STALE_TARGET: 'The source ticket or task changed.', INVALID_TARGET: 'Invalid insertion anchor.',
  ACTION_UNAVAILABLE: 'Action is disabled in the current phase.', IDEMPOTENCY_CONFLICT: 'A request ID has another payload.',
  VERSION_MISMATCH: 'Dataset, schema, or implementation differs; preserve and export evidence.', CORRUPT_SESSION: 'Stored integrity check failed; no repair was performed.',
  SESSION_LIMIT: 'Command or document bound reached; existing records are preserved.', WRITE_FAILED: 'No atomic rename committed.',
  WRITE_UNCERTAIN: 'Rename completed but durability confirmation failed; reconcile the receipt.', WAIT_LIMIT: '64 concurrent waiters maximum.',
  UNSAFE_PATH: 'Symlink or non-regular storage/static path rejected.', DATA_ROOT_LOCKED: 'Another process or unreconciled crash owns the data root.',
  REQUEST_ABORTED: 'Wait was cancelled.', SERVER_CLOSED: 'Repository is closing.', STATIC_UNAVAILABLE: 'Run the normal startup to build the browser bundle.',
  INTERNAL_ERROR: 'Unexpected server error; no success is implied.',
} as const;

async function readStatic(path: string, root: string): Promise<string> {
  const local = relative(root, path);
  if (!local || isAbsolute(local) || local.split(sep).some(part => part === '..')) throw new DomainError('UNSAFE_PATH', 'Invalid static asset path.', 404);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new DomainError('UNSAFE_PATH', 'Static asset root must not be a symlink.', 404);
  let current = root;
  const parts = local.split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new DomainError('UNSAFE_PATH', 'Refusing a symlink or non-regular static asset.', 404);
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > LIMITS.documentBytes) throw new DomainError('STATIC_UNAVAILABLE', 'Static asset exceeds the supported size.', 503);
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.readFile());
  } finally { await file.close(); }
}

async function staticAllowlist(): Promise<Map<string, StaticAsset>> {
  const assets = new Map<string, StaticAsset>();
  const htmlPath = join(WEB_ROOT, 'index.html');
  assets.set('/', { path: htmlPath, contentType: 'text/html; charset=utf-8', text: await readStatic(htmlPath, WEB_ROOT) });
  const loadCss = async (path: string): Promise<void> => {
    const local = relative(WEB_ROOT, path).split(sep).join('/');
    const route = `/${local}`;
    if (assets.has(route)) return;
    if (extname(path) !== '.css' || local.startsWith('../') || isAbsolute(local)) throw new DomainError('UNSAFE_PATH', 'CSS imports must remain inside web/.', 500);
    const text = await readStatic(path, WEB_ROOT);
    assets.set(route, { path, contentType: 'text/css; charset=utf-8', text });
    const imports = /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')/g;
    for (const match of text.matchAll(imports)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
      if (!specifier || /[:?#%\\]/.test(specifier) || specifier.startsWith('//')) throw new DomainError('UNSAFE_PATH', 'Only local CSS imports without URL parameters are supported.', 500);
      await loadCss(specifier.startsWith('/') ? resolve(WEB_ROOT, `.${specifier}`) : resolve(dirname(path), specifier));
    }
  };
  await loadCss(join(WEB_ROOT, 'app.css'));
  const bundle = join(BUILD_ROOT, 'app.js');
  let bundleText: string | null = null;
  try { bundleText = await readStatic(bundle, BUILD_ROOT); }
  catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  assets.set('/app.js', { path: bundle, contentType: 'text/javascript; charset=utf-8', text: bundleText });
  return assets;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}
function checkQuery(url: URL, allowed: readonly string[]): void {
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new DomainError('VALIDATION_ERROR', `Unknown or repeated query parameter: ${key}.`);
}
function integerQuery(url: URL, key: string, maximum: number): number | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new DomainError('VALIDATION_ERROR', `${key} must be a nonnegative integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw new DomainError('VALIDATION_ERROR', `${key} must not exceed ${maximum}.`);
  return number;
}
async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Mutations require Content-Type: application/json.', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMITS.bodyBytes)) throw new DomainError('BODY_TOO_LARGE', 'Request body exceeds 32768 bytes.', 413);
  if (!request.body) throw new DomainError('VALIDATION_ERROR', 'A JSON request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > LIMITS.bodyBytes) { await reader.cancel(); throw new DomainError('BODY_TOO_LARGE', 'Request body exceeds 32768 bytes.', 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new DomainError('VALIDATION_ERROR', 'Expected valid UTF-8 JSON.'); }
}

export async function createApp(options: AppOptions): Promise<App> {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new DomainError('VALIDATION_ERROR', 'Port must be an integer from 1 to 65535.');
  const origin = new URL(`http://127.0.0.1:${options.port}`).origin;
  const expectedHost = new URL(origin).host;
  const nonce = options.nonce ?? crypto.randomUUID();
  if (!nonce || nonce.length > 256 || /[\r\n]/.test(nonce)) throw new DomainError('VALIDATION_ERROR', 'Invalid process nonce.');
  const assets = await staticAllowlist();
  const repository = await createRepository(options);
  const testMode = Boolean(options.testMode);
  const discover = {
    ok: true, protocol: PROTOCOL, nonce, testMode, buildId: options.buildId,
    datasetId: DATASET_ID, datasetDigest: DATASET_DIGEST, candidateVersions: CANDIDATE_VERSIONS,
    dataset: { owners: OWNERS, tickets: TICKETS, tasks: TASKS },
    enums: { ownerIds: OWNER_IDS, ticketIds: TICKET_IDS, taskIds: TASK_IDS, paneIds: ['A', 'B', 'chosen'], choices: ['A', 'B', 'both-bad', 'skip'], modes: testMode ? ['rehearsal', 'test'] : ['rehearsal', 'recording'], clients: ['ui', 'agent'] },
    schemas: { dialect: 'https://json-schema.org/draft/2020-12/schema', create: CREATE_REQUEST_SCHEMA, actionEnvelope: ACTION_ENVELOPE_SCHEMA, actions: ACTION_SCHEMAS, session: SESSION_SCHEMA },
    actionTypes: ACTION_TYPES, limits: { ...LIMITS, concurrentWaiters: 64, viewportDimension: 10000 },
    endpoints: { discover: '/api/v1/discover', list: '/api/v1/sessions', create: '/api/v1/sessions', inspect: '/api/v1/sessions/{mode}/{id}', act: '/api/v1/sessions/{mode}/{id}/actions', wait: '/api/v1/sessions/{mode}/{id}/wait', diagnose: '/api/v1/sessions/{mode}/{id}/diagnose', export: '/api/v1/sessions/{mode}/{id}/export?format=json|md' },
    mutationHeaders: { 'Content-Type': 'application/json', 'x-tot-client': 'ui|agent', 'x-tot-nonce': nonce },
    provenance: { agent: 'Create/mutate rehearsal only; inspect/export all enabled modes. No ballots or selection.', ui: 'Recording choices are human-ui; test choices are test-fixture. Neither label authenticates a person.', recording: 'Disabled in test mode; new sessions always start at S0.', rehearsal: 'Scratch notes and prepared tasks; no preferences, Finish, or selection.' },
    capabilities: { inspect: true, semanticTargets: true, idempotentActions: true, boundedWait: true, diagnostics: true, jsonExport: true, markdownExport: true, agentRehearsalMutation: true, agentPreferenceVote: false, authenticatedHumanIdentity: false },
    limitations: ['Single local server, not authenticated collaboration.', 'Fixed fixture and A-left/B-right order; not a controlled usability study.', 'Atomic persistence is not a backup.', 'No Jira integration, capacity enforcement, scheduling, inferred winner, or model training.', 'No hot reload, session migration, destructive API, or automatic stale-lock removal.', 'Inspect returns the whole bounded session; no pane/ticket query filters.'],
    errors: ERROR_CODES,
  };

  async function fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin || (request.headers.get('host') ?? url.host) !== expectedHost) throw new DomainError('FORBIDDEN_HOST', `Use ${origin}; other hosts are not accepted.`, 403);
      const requestOrigin = request.headers.get('origin');
      if ((requestOrigin !== null && requestOrigin !== origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('FORBIDDEN_ORIGIN', 'Foreign-origin requests are not allowed.', 403);
      if (/%|\\|\0/.test(url.pathname) || url.pathname.split('/').includes('..')) throw new DomainError('VALIDATION_ERROR', 'Encoded or traversing paths are not supported.');
      const headerClient = request.headers.get('x-tot-client');
      if (headerClient !== null && headerClient !== 'ui' && headerClient !== 'agent') throw new DomainError('FORBIDDEN_ACTOR', 'x-tot-client must be ui or agent.', 403);
      const client: ClientClass = headerClient ?? 'ui';
      if (request.method === 'POST') {
        if (headerClient === null) throw new DomainError('FORBIDDEN_ACTOR', 'Mutations require an explicit x-tot-client.', 403);
        if (request.headers.get('x-tot-nonce') !== nonce) throw new DomainError('INVALID_NONCE', 'Discover the current process nonce before mutating.', 403);
      }
      const requireMethod = (...methods: string[]): void => {
        if (!methods.includes(request.method)) throw new DomainError('METHOD_NOT_ALLOWED', `Expected ${methods.join(' or ')}.`, 405);
      };
      if (url.pathname === '/api/v1/discover') {
        requireMethod('GET'); checkQuery(url, []); return response(discover);
      }
      if (url.pathname === '/api/v1/sessions') {
        checkQuery(url, []); requireMethod('GET', 'POST');
        if (request.method === 'GET') return response({ ok: true, sessions: await repository.list() });
        const state = await repository.create(parseCreateRequest(await readJson(request)), client);
        return response(inspectState(state, client));
      }
      const match = /^\/api\/v1\/sessions\/([^/]+)\/([^/]+)(?:\/(actions|wait|diagnose|export))?$/.exec(url.pathname);
      if (match) {
        const ref = parseSessionRef({ mode: match[1], id: match[2] });
        authorizeMode(ref.mode, testMode);
        const operation = match[3];
        if (operation === 'actions') {
          requireMethod('POST'); checkQuery(url, []);
          const result = await repository.commit(ref, parseActionEnvelope(await readJson(request)), client);
          return response({ ...inspectState(result.state, client), ...result });
        }
        requireMethod('GET');
        if (operation === 'wait') {
          checkQuery(url, ['afterRevision', 'requestId', 'timeoutMs']);
          const afterRevision = integerQuery(url, 'afterRevision', Number.MAX_SAFE_INTEGER);
          const timeoutMs = integerQuery(url, 'timeoutMs', LIMITS.waitMs) ?? 5000;
          const requestId = url.searchParams.get('requestId') ?? undefined;
          if (requestId !== undefined && !new RegExp(UUID_PATTERN).test(requestId)) throw new DomainError('VALIDATION_ERROR', 'requestId must be a lowercase UUID.');
          return response(await repository.wait(ref, { afterRevision, requestId, timeoutMs, signal: request.signal }));
        }
        if (operation === 'diagnose') {
          checkQuery(url, []);
          const diagnostic = await repository.diagnose(ref);
          const actions = diagnostic.state ? availableActions(diagnostic.state, client) : null;
          if (actions && diagnostic.version.compatible === false) for (const type of ACTION_TYPES) actions[type] = { enabled: false, reason: 'Session implementation or dataset is incompatible; export without migration.' };
          return response({ ...diagnostic, availableActions: actions });
        }
        if (operation === 'export') {
          checkQuery(url, ['format']);
          const format = url.searchParams.get('format') ?? 'json';
          if (format !== 'json' && format !== 'md') throw new DomainError('VALIDATION_ERROR', 'Export format must be json or md.');
          const evidence = await repository.readEvidence(ref);
          let json: unknown;
          let markdown: string;
          try {
            const state = parseSessionDocument(evidence);
            json = exportSession(state, options.buildId);
            markdown = format === 'md' ? exportMarkdown(state, options.buildId) : '';
          } catch (error) {
            if (!(error instanceof DomainError) || !['VERSION_MISMATCH', 'CORRUPT_SESSION'].includes(error.code)) throw error;
            json = exportUninterpreted(ref, evidence, error.message);
            markdown = format === 'md' ? exportUninterpretedMarkdown(ref, evidence, error.message) : '';
          }
          const headers = { ...SECURITY_HEADERS, 'Content-Disposition': `attachment; filename="this-or-that-${ref.mode}-${ref.id}.${format}"`, 'Content-Type': format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8' };
          return new Response(format === 'md' ? markdown : JSON.stringify(json, null, 2), { headers });
        }
        checkQuery(url, []);
        return response(inspectState(await repository.read(ref), client));
      }
      requireMethod('GET', 'HEAD'); checkQuery(url, []);
      const shell = /^\/(compare|chosen)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      let asset = assets.get(url.pathname);
      if (shell) {
        const ref: SessionRef = parseSessionRef({ mode: shell[2], id: shell[3] });
        authorizeMode(ref.mode, testMode);
        const state = await repository.read(ref);
        if (shell[1] === 'chosen' && !state.chosen) throw new DomainError('ACTION_UNAVAILABLE', 'No widget is selected for this comparison.', 409);
        asset = assets.get('/');
      }
      if (!asset) throw new DomainError('NOT_FOUND', 'No allowlisted route or static asset exists here.', 404);
      if (asset.text === null) throw new DomainError('STATIC_UNAVAILABLE', 'The browser bundle is missing. Launch with bun run start.', 503);
      return new Response(request.method === 'HEAD' ? null : asset.text, { headers: { ...SECURITY_HEADERS, 'Content-Type': asset.contentType } });
    } catch (error) {
      if (error instanceof DomainError) return response({ ok: false, error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } }, error.status);
      console.error('This or that request failed:', error);
      return response({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error. No success is implied; preserve pending work and reconcile its request ID.' } }, 500);
    }
  }
  return { fetch, close: () => repository.close() };
}
