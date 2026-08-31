import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DomainError, LIMITS, type ActionEnvelope, type ClientClass, type CreateRequest, type SessionDocument, type SessionMode, type SessionRef } from '../shared/contract';
import { digest } from '../shared/canonical';
import { applyAction, makeSession } from '../shared/reducer';
import { compatibilityIssues, parseActionEnvelope, parseCreateRequest, parseSessionDocument, parseSessionRef, UUID_PATTERN } from '../shared/validate';
import { actionProvenance, authorizeAction, authorizeActor, authorizeCreate, authorizeMode } from './policy';

export interface RepositoryOptions {
  dataRoot: string; buildId: string; testMode?: boolean;
  beforePersist?: (document: Readonly<SessionDocument>) => void | Promise<void>;
}
interface PersistenceFailure { code: string; message: string; at: string; mayHaveCommitted: boolean }
export interface WaitOptions { afterRevision?: number; requestId?: string; timeoutMs: number; signal?: AbortSignal }
export interface SessionSummary {
  ref: SessionRef; revision: number; phase: 'active' | 'finished';
  taskId: SessionDocument['comparison']['taskId']; selected: 'A' | 'B' | null; updatedAt: string;
}
function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

/** No filesystem path is ever accepted from an HTTP caller. */
export class Repository {
  readonly root: string;
  private readonly lock: FileHandle;
  private readonly token: string;
  private readonly options: RepositoryOptions;
  private readonly mutexes = new Map<string, Promise<void>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly failures = new Map<string, PersistenceFailure>();
  private readonly acknowledged = new Map<string, string>();
  private closed = false;
  private waiterCount = 0;
  private directorySync: 'not-attempted' | 'supported' | 'unsupported' = 'not-attempted';

  private constructor(root: string, lock: FileHandle, token: string, options: RepositoryOptions) {
    this.root = root; this.lock = lock; this.token = token; this.options = options;
  }
  static async open(options: RepositoryOptions): Promise<Repository> {
    const requestedRoot = resolve(options.dataRoot);
    await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
    const info = await lstat(requestedRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new DomainError('UNSAFE_PATH', 'The data root must be a real directory, not a symlink.', 409);
    const root = await realpath(requestedRoot);
    const path = join(root, '.lock');
    let lock: FileHandle;
    try { lock = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (errorCode(error) === 'EEXIST' || errorCode(error) === 'ELOOP') throw new DomainError('DATA_ROOT_LOCKED', 'This data root is locked. Stop its owning server; after a crash, verify the recorded PID is no longer running before removing only .lock.', 409);
      throw error;
    }
    const token = crypto.randomUUID();
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
      await lock.sync();
    } catch (error) {
      await lock.close();
      await unlink(path);
      throw error;
    }
    return new Repository(root, lock, token, options);
  }

  private ensureOpen(): void {
    if (this.closed) throw new DomainError('SERVER_CLOSED', 'The repository is closing.', 503);
  }
  private async directory(mode: SessionMode, create = false): Promise<string> {
    const path = join(this.root, mode);
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (errorCode(error) !== 'EEXIST') throw error; });
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new DomainError('UNSAFE_PATH', 'Refusing a symlink or non-directory session namespace.', 409);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new DomainError('NOT_FOUND', 'Session not found.', 404);
      throw error;
    }
    return path;
  }
  private async serialized<T>(id: string, work: () => Promise<T>): Promise<T> {
    this.ensureOpen();
    const previous = this.mutexes.get(id) ?? Promise.resolve();
    const operation = previous.then(work);
    const settled = operation.then(() => {}, () => {});
    this.mutexes.set(id, settled);
    try { return await operation; }
    finally { if (this.mutexes.get(id) === settled) this.mutexes.delete(id); }
  }

  async readEvidence(ref: SessionRef): Promise<unknown> {
    this.ensureOpen();
    parseSessionRef(ref);
    authorizeMode(ref.mode, Boolean(this.options.testMode));
    const directory = await this.directory(ref.mode);
    const path = join(directory, `${ref.id}.json`);
    let file: FileHandle;
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new DomainError('UNSAFE_PATH', 'Refusing a symlink or non-regular session file.', 409);
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new DomainError('NOT_FOUND', 'Session not found.', 404);
      if (errorCode(error) === 'ELOOP') throw new DomainError('UNSAFE_PATH', 'Refusing a symlink session file.', 409);
      throw error;
    }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > LIMITS.documentBytes) throw new DomainError('CORRUPT_SESSION', 'Session is not a bounded regular document; it has been preserved.', 409);
      const bytes = await file.readFile();
      if (bytes.length > LIMITS.documentBytes) throw new DomainError('CORRUPT_SESSION', 'Session exceeds the document limit; it has been preserved.', 409);
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new DomainError('CORRUPT_SESSION', 'Session is not valid UTF-8 JSON; it has been preserved.', 409); }
      if (!value || typeof value !== 'object' || !('ref' in value)) throw new DomainError('CORRUPT_SESSION', 'Session identity is missing; the file has been preserved.', 409);
      let storedRef: SessionRef;
      try { storedRef = parseSessionRef(value.ref); }
      catch { throw new DomainError('CORRUPT_SESSION', 'Stored session identity is malformed.', 409); }
      if (storedRef.mode !== ref.mode || storedRef.id !== ref.id) throw new DomainError('CORRUPT_SESSION', 'Stored identity differs from the requested session.', 409);
      const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
      while (pending.length) {
        const item = pending.pop()!;
        if (item.depth > 32) throw new DomainError('CORRUPT_SESSION', 'Session nesting exceeds the supported bound; the file has been preserved.', 409);
        if (item.value && typeof item.value === 'object') {
          for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
        }
      }
      return value;
    } finally { await file.close(); }
  }
  async read(ref: SessionRef, requireCompatible = true): Promise<SessionDocument> {
    const state = parseSessionDocument(await this.readEvidence(ref));
    const issues = compatibilityIssues(state, this.options.buildId);
    if (requireCompatible && issues.length) throw new DomainError('VERSION_MISMATCH', 'Session belongs to another dataset or implementation build. Export it; do not overwrite it.', 409, { issues });
    return state;
  }

  private async persist(state: SessionDocument): Promise<void> {
    const key = `${state.ref.mode}/${state.ref.id}`;
    const directory = join(this.root, state.ref.mode);
    const destination = join(directory, `${state.ref.id}.json`);
    const temporary = join(directory, `.${state.ref.id}.${crypto.randomUUID()}.tmp`);
    const text = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(text) > LIMITS.documentBytes) throw new DomainError('SESSION_LIMIT', 'Session document limit reached; existing evidence is preserved.', 409);
    let renamed = false;
    let created = false;
    try {
      await this.directory(state.ref.mode, true);
      try {
        const existing = await lstat(destination);
        if (existing.isSymbolicLink() || !existing.isFile()) throw new DomainError('UNSAFE_PATH', 'Refusing an unsafe session destination.', 409);
      } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      created = true;
      try { await file.writeFile(text); await file.sync(); }
      finally { await file.close(); }
      if (this.options.beforePersist) await this.options.beforePersist(structuredClone(state));
      await rename(temporary, destination);
      renamed = true;
      const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        try { await directoryHandle.sync(); this.directorySync = 'supported'; }
        catch (error) {
          if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(errorCode(error) ?? '')) this.directorySync = 'unsupported';
          else throw error;
        }
      } finally { await directoryHandle.close(); }
      this.acknowledged.set(key, new Date().toISOString());
    } catch (error) {
      const code = renamed ? 'WRITE_UNCERTAIN' : 'WRITE_FAILED';
      const message = renamed ? 'The rename completed but durability could not be confirmed. Reconcile the same request ID before retrying.' : 'The write did not commit. Existing session data is unchanged; preserve and retry the exact request.';
      this.failures.set(key, { code, message, at: new Date().toISOString(), mayHaveCommitted: renamed });
      if (error instanceof DomainError && error.code === 'UNSAFE_PATH') throw error;
      throw new DomainError(code, message, 503);
    } finally {
      if (created && !renamed) await unlink(temporary).catch(() => {});
      if (renamed) for (const listener of this.listeners.get(key) ?? []) listener();
    }
  }

  async create(input: CreateRequest, client: ClientClass): Promise<SessionDocument> {
    const request = structuredClone(parseCreateRequest(input));
    authorizeCreate(request.mode, client, Boolean(this.options.testMode));
    return this.serialized(request.requestId, async () => {
      const ref = { mode: request.mode, id: request.requestId };
      try { return await this.read(ref); }
      catch (error) { if (!(error instanceof DomainError) || error.code !== 'NOT_FOUND') throw error; }
      // A creation UUID cannot be reused with a different mode/payload.
      for (const mode of ['rehearsal', 'recording', 'test'] as const) {
        if (mode === request.mode) continue;
        try {
          const directory = await this.directory(mode);
          await lstat(join(directory, `${request.requestId}.json`));
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Creation request ID was already used for a different session mode.', 409);
        } catch (error) {
          if (errorCode(error) === 'ENOENT' || (error instanceof DomainError && error.code === 'NOT_FOUND')) continue;
          throw error;
        }
      }
      const state = makeSession(ref, this.options.buildId);
      parseSessionDocument(state);
      await this.persist(state);
      return state;
    });
  }
  async commit(ref: SessionRef, input: ActionEnvelope, client: ClientClass): Promise<{ state: SessionDocument; requestId: string; appliedRevision: number; revision: number; replayed: boolean }> {
    parseSessionRef(ref);
    const envelope = structuredClone(parseActionEnvelope(input));
    const payloadDigest = digest(envelope);
    return this.serialized(ref.id, async () => {
      const current = await this.read(ref);
      authorizeActor(current, envelope.action, client, Boolean(this.options.testMode));
      const existing = current.receipts.find(receipt => receipt.requestId === envelope.requestId);
      if (existing) {
        if (existing.payloadDigest !== payloadDigest) throw new DomainError('IDEMPOTENCY_CONFLICT', 'This request ID has a different payload. Do not reuse it for another action.', 409);
        return { state: current, requestId: existing.requestId, appliedRevision: existing.appliedRevision, revision: current.revision, replayed: true };
      }
      if (envelope.expectedRevision !== current.revision) throw new DomainError('STALE_REVISION', 'Session changed; inspect it and explicitly decide whether to reapply.', 409, { expected: envelope.expectedRevision, actual: current.revision });
      if (current.receipts.length >= LIMITS.receipts) throw new DomainError('SESSION_LIMIT', 'The accepted-command limit is reached. Export this session and start a new one.', 409);
      authorizeAction(current, envelope.action, client, Boolean(this.options.testMode));
      const at = new Date().toISOString();
      const reduced = applyAction(current, envelope.action, { now: at, provenance: actionProvenance(current, client) });
      const state: SessionDocument = { ...reduced, revision: current.revision + 1, updatedAt: at, receipts: [...current.receipts, { requestId: envelope.requestId, payloadDigest, appliedRevision: current.revision + 1, at, actionType: envelope.action.type }] };
      parseSessionDocument(state);
      await this.persist(state);
      return { state, requestId: envelope.requestId, appliedRevision: state.revision, revision: state.revision, replayed: false };
    });
  }

  async list(): Promise<SessionSummary[]> {
    this.ensureOpen();
    const sessions: SessionSummary[] = [];
    const modes: SessionMode[] = this.options.testMode ? ['rehearsal', 'test'] : ['rehearsal', 'recording'];
    for (const mode of modes) {
      let directory: string;
      try { directory = await this.directory(mode); }
      catch (error) { if (error instanceof DomainError && error.code === 'NOT_FOUND') continue; throw error; }
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -5);
        if (!new RegExp(UUID_PATTERN).test(id)) continue;
        const ref = { mode, id };
        const state = await this.read(ref, false);
        sessions.push({ ref, revision: state.revision, phase: state.comparison.phase, taskId: state.comparison.taskId, selected: state.selection?.variantId ?? null, updatedAt: state.updatedAt });
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.ref.id.localeCompare(b.ref.id));
  }

  async wait(ref: SessionRef, options: WaitOptions) {
    parseSessionRef(ref);
    if (this.waiterCount >= 64) throw new DomainError('WAIT_LIMIT', 'Too many concurrent waiters; at most 64 are supported.', 429);
    this.waiterCount++;
    const key = `${ref.mode}/${ref.id}`;
    const deadline = Date.now() + options.timeoutMs;
    let after = options.afterRevision;
    try {
      while (true) {
        this.ensureOpen();
        if (options.signal?.aborted) throw new DomainError('REQUEST_ABORTED', 'Wait request was cancelled.', 499);
        let wake: () => void = () => {};
        const changed = new Promise<void>(resolve => { wake = resolve; });
        let listeners = this.listeners.get(key);
        if (!listeners) { listeners = new Set(); this.listeners.set(key, listeners); }
        listeners.add(wake);
        const timer = setTimeout(wake, Math.max(0, deadline - Date.now()));
        options.signal?.addEventListener('abort', wake, { once: true });
        try {
          const state = await this.read(ref);
          after ??= state.revision;
          const receipt = options.requestId ? state.receipts.find(item => item.requestId === options.requestId) ?? null : null;
          const ready = options.requestId ? receipt !== null : state.revision > after;
          if (ready || Date.now() >= deadline) return { ok: true as const, status: ready ? 'ready' as const : 'timeout' as const, revision: state.revision, receipt, state };
          await changed;
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', wake);
          listeners.delete(wake);
          if (!listeners.size) this.listeners.delete(key);
        }
      }
    } finally { this.waiterCount--; }
  }

  async diagnose(ref: SessionRef) {
    const key = `${ref.mode}/${ref.id}`;
    let state: SessionDocument | null = null;
    let failure: { code: string; message: string; details?: unknown } | null = null;
    try { state = await this.read(ref, false); }
    catch (error) {
      if (!(error instanceof DomainError) || !['CORRUPT_SESSION', 'VERSION_MISMATCH'].includes(error.code)) throw error;
      failure = { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
    }
    const issues = state ? compatibilityIssues(state, this.options.buildId) : [];
    return {
      ok: true as const, ref, state, revision: state?.revision ?? null,
      invariants: { ok: state !== null, error: failure },
      version: { compatible: state ? issues.length === 0 : null, currentBuildId: this.options.buildId, sessionBuildId: state?.buildId ?? null, issues },
      persistence: { lastError: this.failures.get(key) ?? null, lastAcknowledgedAt: this.acknowledged.get(key) ?? null, writable: 'not-probed', directorySync: this.directorySync },
      recovery: failure ? ['Preserve the session file; it is never automatically repaired or replaced.', 'Export bounded parseable evidence if available.', 'Create a new session rather than overwriting this record.'] : ['Inspect current revisions and reconcile pending request IDs with wait.', 'Retry an uncertain action only with its original request ID and exact envelope.', 'Export before deliberately deleting any recording.'],
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const listeners of this.listeners.values()) for (const wake of listeners) wake();
    await Promise.all(this.mutexes.values());
    await this.lock.close();
    const path = join(this.root, '.lock');
    let current: FileHandle | undefined;
    try {
      current = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const value: unknown = JSON.parse(await current.readFile('utf8'));
      if (value && typeof value === 'object' && 'token' in value && value.token === this.token) await unlink(path);
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    finally { await current?.close(); }
  }
}

export async function createRepository(options: RepositoryOptions): Promise<Repository> {
  return Repository.open(options);
}
