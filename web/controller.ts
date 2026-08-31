import { LIMITS, TASK_IDS, type Action, type ActionEnvelope, type ActionResponse, type ApiError, type CreateRequest, type Inspection, type SessionMode, type SessionRef, type TaskId } from '../shared/contract';

export interface SessionSummary {
  ref: SessionRef; revision: number; phase: 'active' | 'finished'; taskId: TaskId;
  selected: unknown; updatedAt: string;
}
interface Discovery { ok: true; nonce: string; testMode: boolean }
type Pending = { kind: 'action'; ref: SessionRef; body: ActionEnvelope } | { kind: 'create'; body: CreateRequest };
interface Recovery {
  label: 'Unsaved recovery data — not a preference record';
  ref: SessionRef | null; drafts: Partial<Record<TaskId, string>>; selectionReason: string;
  notesNeedReview: boolean; pending: Pending | null; rejected: Pending | null;
}
class RequestError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const storagePrefix = 'this-or-that:v1:';

export function textProblem(text: string): string {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.codePointAt(index)! > 0xffff) index++;
    if (++count > LIMITS.noteCharacters) return `Use at most ${LIMITS.noteCharacters.toLocaleString()} Unicode characters. Your full text is retained.`;
  }
  return '';
}

export class Controller {
  inspection: Inspection | null = null;
  discovery: Discovery | null = null;
  sessions: SessionSummary[] = [];
  pending: Pending | null = null;
  rejected: Pending | null = null;
  busy = false;
  loading = true;
  transitioning = false;
  notesNeedReview = false;
  error = '';
  storageWarning = '';
  route: 'home' | 'compare' | 'chosen' = 'home';
  ref: SessionRef | null = null;
  private drafts: Partial<Record<TaskId, string>> = {};
  private reasonDraft = '';
  private interacting = false;
  private generation = 0;
  private listeners = new Set<() => void>();
  private noteTimer: number | undefined;

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  get blocked(): boolean { return this.loading || this.busy || this.transitioning || this.pending !== null; }
  get canRefresh(): boolean { return !this.loading && !this.busy && !this.transitioning && !this.interacting; }
  get dirty(): boolean { return Object.keys(this.drafts).length > 0 || this.reasonDraft !== ''; }
  get selectionReason(): string { return this.reasonDraft; }
  get strandedNotes(): [TaskId, string][] {
    const comparison = this.inspection?.state.comparison;
    return TASK_IDS.flatMap(task => this.drafts[task] !== undefined && (!comparison || comparison.phase !== 'active' || comparison.taskPhase !== 'playing' || task !== comparison.taskId) ? [[task, this.drafts[task]!] as [TaskId, string]] : []);
  }
  get status(): string {
    if (this.loading) return this.inspection ? 'Refreshing saved state…' : 'Loading session…';
    if (this.busy || this.transitioning) return 'Saving…';
    if (this.pending || this.error) return 'Not saved';
    if (this.strandedNotes.length || this.notesNeedReview) return 'Unsaved notes need review';
    if (Object.keys(this.drafts).length) return 'Note not saved yet';
    if (this.reasonDraft) return 'Selection reason draft · not submitted';
    return this.inspection ? `Saved · revision ${this.inspection.state.revision}` : 'Local workbench';
  }
  available(type: Action['type']): boolean { return !this.blocked && Boolean(this.inspection?.availableActions[type]?.enabled); }
  note(taskId: TaskId): string { return this.drafts[taskId] ?? this.inspection?.state.comparison.drafts[taskId] ?? ''; }
  recovery(): Recovery { return { label: 'Unsaved recovery data — not a preference record', ref: this.ref, drafts: { ...this.drafts }, selectionReason: this.reasonDraft, notesNeedReview: this.notesNeedReview, pending: this.pending, rejected: this.rejected }; }
  private storageKey(): string { return `${storagePrefix}${this.ref ? `${this.ref.mode}:${this.ref.id}` : 'home'}`; }
  private persist(): void {
    try { localStorage.setItem(this.storageKey(), JSON.stringify(this.recovery())); }
    catch { this.storageWarning = 'Browser recovery storage is unavailable. Keep this tab open and download recovery before leaving; reload recovery is not guaranteed.'; }
  }
  private restore(): void {
    this.pending = null; this.rejected = null; this.drafts = {}; this.reasonDraft = ''; this.notesNeedReview = false;
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const value = JSON.parse(raw) as Recovery;
      if (JSON.stringify(value.ref) !== JSON.stringify(this.ref)) return;
      for (const id of TASK_IDS) if (typeof value.drafts?.[id] === 'string') this.drafts[id] = value.drafts[id];
      if (typeof value.selectionReason === 'string') this.reasonDraft = value.selectionReason;
      this.notesNeedReview = value.notesNeedReview === true;
      if (value.pending && (value.pending.kind === 'action' || value.pending.kind === 'create')) this.pending = value.pending;
      if (this.pending?.kind === 'action' && this.pending.body.action.type === 'selection.commit') this.reasonDraft = this.pending.body.action.reason;
      this.rejected = value.rejected ?? null;
    } catch { this.storageWarning = 'Browser recovery data could not be read. Server-saved work is unaffected.'; }
  }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'x-tot-client': 'ui' };
    if (body !== undefined) {
      if (!this.discovery) throw new Error('The local server has not been discovered yet. Retry connection.');
      headers['Content-Type'] = 'application/json'; headers['x-tot-nonce'] = this.discovery.nonce;
    }
    const response = await fetch(`/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const value = await response.json() as T | ApiError;
    if (!response.ok || (value as ApiError).ok === false) {
      const failure = value as ApiError;
      throw new RequestError(failure.error?.code ?? 'HTTP_ERROR', failure.error?.message ?? `Server returned ${response.status}.`);
    }
    return value as T;
  }
  sessionPath(ref = this.ref): string { if (!ref) throw new Error('No session is open.'); return `sessions/${ref.mode}/${ref.id}`; }
  exportUrl(format: 'json' | 'md'): string { return `/api/v1/${this.sessionPath()}/export?format=${format}`; }

  async initialize(): Promise<void> {
    clearTimeout(this.noteTimer);
    const generation = ++this.generation;
    this.inspection = null;
    this.loading = true; this.error = ''; this.emit();
    try {
      const discovery = await this.request<Discovery>('discover');
      if (generation !== this.generation) return;
      this.discovery = discovery;
      const match = location.pathname.match(/^\/(compare|chosen)\/(rehearsal|recording|test)\/([0-9a-f-]+)\/?$/i);
      if (match) {
        this.route = match[1] as 'compare' | 'chosen';
        this.ref = { mode: match[2] as SessionMode, id: match[3]! };
        this.restore();
        const inspection = await this.request<Inspection>(this.sessionPath());
        if (generation !== this.generation) return;
        this.inspection = inspection; this.reconcile();
      } else if (location.pathname === '/') {
        this.route = 'home'; this.ref = null; this.inspection = null; this.restore();
        const result = await this.request<{ ok: true; sessions: SessionSummary[] }>('sessions');
        if (generation !== this.generation) return;
        this.sessions = result.sessions;
      } else throw new Error('This route does not exist. Return to the workbench home to open a saved session.');
    } catch (error) { if (generation === this.generation) this.error = this.message(error); }
    finally {
      if (generation === this.generation) { this.loading = false; this.emit(); this.scheduleNotes(); }
    }
  }
  private message(error: unknown): string {
    return error instanceof RequestError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'The local server could not be reached.';
  }
  private reconcile(): void {
    if (!this.inspection) return;
    const pending = this.pending;
    if (pending?.kind === 'action' && this.inspection.state.receipts.some(receipt => receipt.requestId === pending.body.requestId)) {
      this.acknowledgeDraft(pending.body.action); this.pending = null;
    }
    const unresolved = this.pending?.kind === 'action' ? this.pending.body.action : null;
    for (const task of TASK_IDS) {
      if ((unresolved?.type === 'note.save' || unresolved?.type === 'decision.record') && unresolved.taskId === task) continue;
      if (this.drafts[task] === (this.inspection.state.comparison.drafts[task] ?? '')) delete this.drafts[task];
    }
    if (this.inspection.state.selection?.reason === this.reasonDraft) this.reasonDraft = '';
    if (!Object.keys(this.drafts).length) this.notesNeedReview = false;
    if (this.pending) this.error = 'An earlier request is unresolved. Retry the identical request, or explicitly reload server state without reapplying it.';
    this.persist();
  }
  private acknowledgeDraft(action: Action): void {
    if (action.type === 'note.save' && this.drafts[action.taskId] === action.text) delete this.drafts[action.taskId];
    if (action.type === 'decision.record' && this.drafts[action.taskId] === action.note) delete this.drafts[action.taskId];
    if (action.type === 'selection.commit' && this.reasonDraft === action.reason) this.reasonDraft = '';
    if (!Object.keys(this.drafts).length) this.notesNeedReview = false;
  }
  setInteractionActive(active: boolean): void {
    this.interacting = active;
    clearTimeout(this.noteTimer);
    if (!active) this.scheduleNotes();
  }
  private scheduleNotes(): void {
    clearTimeout(this.noteTimer);
    if (this.interacting || this.blocked || this.notesNeedReview || !Object.keys(this.drafts).length || this.strandedNotes.length || !this.available('note.save')) return;
    this.noteTimer = window.setTimeout(() => { void this.saveNotes(); }, 650);
  }
  setNote(task: TaskId, text: string): void {
    if (this.transitioning) return;
    this.drafts[task] = text;
    this.notesNeedReview = false; this.persist(); this.scheduleNotes();
  }
  setSelectionReason(text: string): void {
    if (this.transitioning || this.pending || this.inspection?.state.selection) return;
    this.reasonDraft = text; this.persist();
  }
  discardStrandedNote(task: TaskId): void {
    if (this.blocked || !this.strandedNotes.some(([id]) => id === task)) return;
    delete this.drafts[task]; this.error = ''; this.persist(); this.emit();
  }
  private fail(message: string): false { this.error = message; this.emit(); return false; }
  private async flushNotes(): Promise<boolean> {
    clearTimeout(this.noteTimer);
    if (this.loading || this.busy || this.pending || this.interacting) return false;
    if (this.strandedNotes.length) return this.fail('An unsaved note belongs to a prior or sealed task. Review and download its recovery text before explicitly discarding it; this transition has not been applied.');
    while (Object.keys(this.drafts).length) {
      const task = this.inspection?.state.comparison.taskId;
      if (!task) return false;
      const text = this.drafts[task];
      if (text === undefined) return false;
      if (text === (this.inspection!.state.comparison.drafts[task] ?? '')) { delete this.drafts[task]; continue; }
      const problem = textProblem(text);
      if (problem) return this.fail(`Note: ${problem}`);
      if (!await this.dispatch({ type: 'note.save', taskId: task, text })) return false;
      // A normal autosave permits typing during the request; flush the newer text too.
    }
    this.notesNeedReview = false; this.error = ''; this.persist(); this.emit(); return true;
  }
  async saveNotes(): Promise<boolean> {
    if (this.blocked || this.interacting) return false;
    this.notesNeedReview = false;
    return this.flushNotes();
  }
  private async transition(work: () => Promise<boolean>): Promise<boolean> {
    if (this.blocked || this.interacting) return false;
    if (this.notesNeedReview) return this.fail('Fresh server state is visible. Review your retained note and choose Save note now before leaving or changing tasks.');
    this.transitioning = true; clearTimeout(this.noteTimer); this.emit();
    try {
      if (!await this.flushNotes()) return false;
      this.persist();
      if (this.reasonDraft && this.storageWarning) return this.fail('The selection reason is not submitted and browser recovery is unavailable. Download recovery before leaving; this transition is blocked.');
      return await work();
    } finally { this.transitioning = false; this.emit(); this.scheduleNotes(); }
  }
  async create(mode: SessionMode): Promise<boolean> {
    return this.transition(async () => {
      this.pending = { kind: 'create', body: { requestId: crypto.randomUUID(), mode } };
      this.persist(); return this.sendPending();
    });
  }
  async act(action: Action): Promise<boolean> {
    if (!this.available(action.type) || this.interacting) return false;
    if (action.type === 'scenario.load' || action.type === 'scenario.advance' || action.type === 'comparison.finish') return this.transition(() => this.dispatch(action));
    return this.dispatch(action);
  }
  private async dispatch(action: Action): Promise<boolean> {
    if (this.loading || this.busy || this.pending || !this.inspection || !this.ref || !this.inspection.availableActions[action.type]?.enabled) return false;
    const text = action.type === 'note.save' ? action.text : action.type === 'decision.record' ? action.note : action.type === 'selection.commit' ? action.reason : undefined;
    if (text !== undefined) { const problem = textProblem(text); if (problem) return this.fail(problem); }
    this.pending = { kind: 'action', ref: this.ref, body: { requestId: crypto.randomUUID(), expectedRevision: this.inspection.state.revision, action } };
    this.persist(); return this.sendPending();
  }
  async retry(): Promise<boolean> {
    if (!this.pending || !this.canRefresh) return false;
    this.loading = true; this.emit();
    try { this.discovery = await this.request<Discovery>('discover'); }
    catch (error) { this.error = this.message(error); this.loading = false; this.emit(); return false; }
    this.loading = false;
    return this.sendPending();
  }
  private async sendPending(): Promise<boolean> {
    const pending = this.pending;
    if (!pending) return false;
    this.busy = true; this.error = ''; this.emit();
    try {
      if (pending.kind === 'create') {
        const inspection = await this.request<Inspection>('sessions', pending.body);
        this.pending = null; this.persist();
        this.ref = inspection.state.ref; this.inspection = inspection; this.route = 'compare'; this.drafts = {}; this.reasonDraft = ''; this.notesNeedReview = false; this.rejected = null;
        history.pushState(null, '', `/compare/${this.ref.mode}/${this.ref.id}`);
      } else {
        const inspection = await this.request<ActionResponse>(`${this.sessionPath(pending.ref)}/actions`, pending.body);
        if (inspection.requestId !== pending.body.requestId) throw new Error('The response did not acknowledge this request. Retry to reconcile it.');
        this.inspection = inspection; this.acknowledgeDraft(pending.body.action); this.pending = null;
      }
      this.persist(); return true;
    } catch (error) { this.error = `${this.message(error)} Your proposed action and notes are retained; nothing is shown as saved without acknowledgment.`; this.persist(); return false; }
    finally { this.busy = false; this.emit(); this.scheduleNotes(); }
  }
  async refreshSavedState(): Promise<boolean> {
    if (!this.canRefresh) return false;
    clearTimeout(this.noteTimer);
    const generation = ++this.generation;
    const ref = this.ref;
    const revision = this.inspection?.state.revision;
    this.loading = true; this.emit();
    try {
      const discovery = await this.request<Discovery>('discover');
      if (generation !== this.generation) return false;
      if (ref) {
        const inspection = await this.request<Inspection>(this.sessionPath(ref));
        if (generation !== this.generation || this.ref !== ref) return false;
        if (this.inspection && inspection.state.revision < this.inspection.state.revision) throw new Error('An older server revision was returned. Current state and recovery have been retained.');
        this.inspection = inspection;
        if (revision !== inspection.state.revision && Object.keys(this.drafts).length) this.notesNeedReview = true;
        this.error = ''; this.reconcile();
      } else {
        const result = await this.request<{ ok: true; sessions: SessionSummary[] }>('sessions');
        if (generation !== this.generation || this.ref !== ref) return false;
        this.sessions = result.sessions; this.error = '';
      }
      this.discovery = discovery; this.persist(); return true;
    } catch (error) { if (generation === this.generation) this.error = this.message(error); return false; }
    finally { if (generation === this.generation) { this.loading = false; this.emit(); this.scheduleNotes(); } }
  }
  async refreshWithoutReapplying(): Promise<void> {
    if (!this.canRefresh) return;
    const pending = this.pending;
    if (!await this.refreshSavedState() || this.loading || this.busy || this.pending !== pending || !pending) return;
    this.rejected = pending; this.pending = null; this.error = '';
    if (Object.keys(this.drafts).length) this.notesNeedReview = true;
    this.persist(); this.emit();
  }
  async finish(): Promise<boolean> { return this.act({ type: 'comparison.finish' }); }
  showChosen(): void {
    const ref = this.ref;
    if (!ref || !this.inspection?.state.chosen) return;
    void this.transition(async () => {
      this.route = 'chosen'; history.pushState(null, '', `/chosen/${ref.mode}/${ref.id}`); this.emit(); return true;
    });
  }
  async navigate(path: string): Promise<void> {
    await this.transition(async () => { history.pushState(null, '', path); await this.initialize(); return !this.error; });
  }
}
