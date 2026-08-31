import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app';
import type { Action } from '../../shared/contract';
import { S0, S1 } from '../../shared/fixture';
import { parseSessionDocument } from '../../shared/validate';

function responsePayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object response');
  const fields = Object.fromEntries(Object.entries(value));
  return {
    raw: value,
    get state() { return parseSessionDocument(fields.state); },
    get error() {
      const e: unknown = fields.error;
      if (!e || typeof e !== 'object' || !('code' in e) || typeof e.code !== 'string') throw new Error('Expected structured error');
      return { code: e.code };
    },
    get nonce() {
      if (typeof fields.nonce !== 'string') throw new Error('Missing mutation nonce');
      return fields.nonce;
    },
    protocol: fields.protocol,
    status: fields.status,
    replayed: fields.replayed,
  };
}

const owned: { close: () => unknown; root: string }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) { await item.close(); await rm(item.root, { recursive: true, force: true }); }
});

async function lab(testMode = true) {
  const root = await mkdtemp(join(tmpdir(), 'tot-api-'));
  let fail = false;
  let hold: (() => Promise<void>) | undefined;
  const app = await createApp({ dataRoot: root, buildId: 'test-build', port: 39831, testMode, beforePersist: async () => { if (fail) throw new Error('Injected storage failure'); if (hold) await hold(); } });
  owned.push({ root, close: app.close });
  const base = 'http://127.0.0.1:39831';
  const d = await app.fetch(new Request(`${base}/api/v1/discover`));
  const discovery = responsePayload(await d.json());
  async function request(path: string, body?: unknown, client = 'ui', extra: Record<string,string> = {}) {
    const res = await app.fetch(new Request(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-tot-client': client, 'x-tot-nonce': discovery.nonce, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: res.status, body: responsePayload(await res.json()) };
  }
  async function create(mode = testMode ? 'test' : 'rehearsal', client = 'ui') {
    const id = crypto.randomUUID();
    const result = await request('/api/v1/sessions', { requestId: id, mode }, client);
    expect(result.status).toBeLessThan(300);
    return { path: `/api/v1/sessions/${mode}/${id}`, state: result.body.state };
  }
  return { app, root, base, discovery, request, create, failWrites: (value: boolean) => { fail = value; }, holdWrites: (hook: () => Promise<void>) => { hold = hook; } };
}
const assignment: Action = { type: 'pane.move', paneId: 'A', expectedPaneRevision: 0, ticketId: 'SPR-103', fromOwnerId: 'backlog', toOwnerId: 'leo', beforeTicketId: 'SPR-107' };

function envelope(expectedRevision: number, action: Action) { return { requestId: crypto.randomUUID(), expectedRevision, action }; }

test('shutdown retains its lock until an in-flight durable write finishes', async () => {
  const l = await lab(); const s = await l.create();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  l.holdWrites(async () => { entered(); await held; });
  const saving = l.request(`${s.path}/actions`, envelope(0, assignment));
  await started;
  let closed = false;
  const closing = l.app.close().then(() => { closed = true; });
  await expect(createApp({dataRoot:l.root,buildId:'test-build',port:39831,testMode:true})).rejects.toMatchObject({code:'DATA_ROOT_LOCKED'});
  expect(closed).toBe(false);
  expect(await Bun.file(join(l.root, '.lock')).exists()).toBe(true);
  release();
  expect((await saving).status).toBe(200);
  await closing;
  expect(await Bun.file(join(l.root, '.lock')).exists()).toBe(false);
  const reopened = await createApp({dataRoot:l.root,buildId:'test-build',port:39831,testMode:true});
  try {
    const response = await reopened.fetch(new Request(l.base+s.path));
    const restored = responsePayload(await response.json()).state;
    expect(restored.revision).toBe(1);
    expect(restored.comparison.panes.A.queues).toEqual(S1);
  } finally { await reopened.close(); }
});

describe('authoritative local comparison API', () => {
  test('discovery and agent rehearsal use the same action state', async () => {
    const l = await lab(false);
    expect(l.discovery.protocol).toBe('this-or-that/v1');
    const s = await l.create('rehearsal', 'agent');
    const command = envelope(0, assignment);
    const moved = await l.request(`${s.path}/actions`, command, 'agent');
    expect(moved.status).toBe(200);
    expect(moved.body.state.comparison.panes.A.queues).toEqual(S1);
    expect(moved.body.state.comparison.panes.B.queues).toEqual(S0);
    const waited = await l.request(`${s.path}/wait?requestId=${command.requestId}&timeoutMs=1`, undefined, 'agent');
    expect(waited.body.status).toBe('ready');
    const diagnosed = await l.request(`${s.path}/diagnose`, undefined, 'agent');
    expect(diagnosed.status).toBe(200);
    const timeout = await l.request(`${s.path}/wait?afterRevision=1&timeoutMs=1`, undefined, 'agent');
    expect(timeout.body.status).toBe('timeout');
  });

  test('replayed commands apply once, and reused IDs cannot change payload', async () => {
    const l = await lab(); const s = await l.create(); const command = envelope(0, assignment);
    const first = await l.request(`${s.path}/actions`, command);
    const replay = await l.request(`${s.path}/actions`, command);
    expect(first.body.state.revision).toBe(1);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.state.revision).toBe(1);
    expect(replay.body.state.comparison.panes.A.undo).toHaveLength(1);
    const bad = await l.request(`${s.path}/actions`, { ...command, action: { ...assignment, beforeTicketId: null } });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('simultaneous stale commands cannot overwrite each other', async () => {
    const l = await lab(); const s = await l.create();
    const responses = await Promise.all([l.request(`${s.path}/actions`, envelope(0, assignment)), l.request(`${s.path}/actions`, envelope(0, assignment))]);
    expect(responses.map(r => r.status).sort()).toEqual([200,409]);
    const current = await l.request(s.path);
    expect(current.body.state.revision).toBe(1);
  });

  test('failed writes acknowledge nothing and preserve the session', async () => {
    const l = await lab(); const s = await l.create(); l.failWrites(true);
    const command = envelope(0, assignment);
    const bad = await l.request(`${s.path}/actions`, command);
    expect(bad.status).toBeGreaterThanOrEqual(500);
    l.failWrites(false);
    const current = await l.request(s.path);
    expect(current.body.state.revision).toBe(0);
    expect(current.body.state.comparison.panes.A.queues).toEqual(S0);
    const retry = await l.request(`${s.path}/actions`, command);
    expect(retry.status).toBe(200);
    expect(retry.body.state.receipts.filter(receipt => receipt.requestId === command.requestId)).toHaveLength(1);
  });

  test('agents cannot manufacture human choices or mutate recordings', async () => {
    const l = await lab(false);
    const recording = await l.create('recording');
    expect((await l.request(`${recording.path}/actions`, envelope(0, assignment), 'agent')).status).toBe(403);
    const fake = await l.request('/api/v1/sessions', { requestId: crypto.randomUUID(), mode: 'recording' }, 'agent');
    expect(fake.status).toBe(403);
    const rehearsal = await l.create('rehearsal', 'agent');
    const vote: Action = { type:'decision.record',taskId:'assign',choice:'A',note:'not a human vote',observedPaneRevisions:{A:0,B:0},presentation:{mode:'side-by-side',width:1600,height:1000} };
    expect((await l.request(`${rehearsal.path}/actions`, envelope(0, vote), 'agent')).status).toBe(403);
  });

  test('test mode cannot create a recording session', async () => {
    const l = await lab();
    const bad = await l.request('/api/v1/sessions', { requestId: crypto.randomUUID(), mode:'recording' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });

  test('ballots save once and do not silently advance or imply selection', async () => {
    const l=await lab(); const s=await l.create();
    const vote:Action={type:'decision.record',taskId:'assign',choice:'both-bad',note:'TEST FIXTURE — neither interaction',observedPaneRevisions:{A:0,B:0},presentation:{mode:'side-by-side',width:1600,height:1000}};
    const saved=await l.request(`${s.path}/actions`,envelope(0,vote));
    expect(saved.status).toBe(200);
    expect(saved.body.state.comparison.taskId).toBe('assign');
    expect(saved.body.state.comparison.taskPhase).toBe('decided');
    expect(saved.body.state.comparison.decisions[0].provenance).toBe('test-fixture');
    expect(saved.body.state.selection).toBeNull();
    const next=await l.request(`${s.path}/actions`,envelope(1,{type:'scenario.advance',taskId:'assign'}));
    expect(next.body.state.comparison.taskId).toBe('prioritize');
    expect(next.body.state.comparison.panes.A.queues).toEqual(S1);
    expect(next.body.state.comparison.panes.B.queues).toEqual(S1);
  });

  test('finish without votes retains drafts and selects nothing', async () => {
    const l=await lab(); const s=await l.create();
    await l.request(`${s.path}/actions`,envelope(0,{type:'note.save',taskId:'assign',text:'TEST FIXTURE — uncast note <script>bad()</script>'}));
    const finish=await l.request(`${s.path}/actions`,envelope(1,{type:'comparison.finish'}));
    expect(finish.body.state.comparison.phase).toBe('finished');
    expect(finish.body.state.comparison.decisions).toHaveLength(0);
    const finishRecord = finish.body.state.comparison.finish;
    if (!finishRecord) throw new Error('Finish record missing after acknowledged finish');
    expect(finishRecord.unvotedTasks).toHaveLength(3);
    expect(finishRecord.snapshot.drafts.assign).toContain('uncast note');
    expect(finish.body.state.selection).toBeNull();
    expect((await l.request(`${s.path}/actions`,envelope(2,assignment))).status).toBeGreaterThanOrEqual(400);
    const exported=await l.request(`${s.path}/export?format=json`);
    expect(exported.status).toBe(200);
    expect(JSON.stringify(exported.body.raw)).toContain('uncast note');
  });

  test('chosen workspace changes never change sealed comparison evidence', async () => {
    const l=await lab(); const s=await l.create();
    const finished=await l.request(`${s.path}/actions`,envelope(0,{type:'comparison.finish'}));
    const original=finished.body.state.comparison.finish;
    const selected=await l.request(`${s.path}/actions`,envelope(1,{type:'selection.commit',variantId:'B',reason:'TEST FIXTURE — not a human selection'}));
    expect(selected.status).toBe(200);
    const chosen=selected.body.state.chosen;
    if (!chosen) throw new Error('Chosen workspace missing after selection');
    const moved=await l.request(`${s.path}/actions`,envelope(2,{...assignment,paneId:'chosen',expectedPaneRevision:chosen.pane.revision}));
    expect(moved.status).toBe(200);
    expect(moved.body.state.chosen?.pane.queues).toEqual(S1);
    expect(moved.body.state.comparison.finish).toEqual(original);
    expect(moved.body.state.comparison.panes.A.queues).toEqual(S0);
  });

  test('foreign origins, malformed input and private paths are refused', async () => {
    const l=await lab();
    const foreign=await l.request('/api/v1/sessions',{requestId:crypto.randomUUID(),mode:'test'},'ui',{origin:'https://foreign.example'});
    expect(foreign.status).toBe(403);
    const malformed=await l.request('/api/v1/sessions',{requestId:'../escape',mode:'test'});
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    for(const path of ['/shared/contract.ts','/.data/recording/x.json','/.notes/review/anything','/api/v1/sessions/test/not-a-uuid']) {
      const response=await l.app.fetch(new Request(l.base+path));
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const s=await l.create();
    const unknown=await l.request(`${s.path}/actions`,{requestId:crypto.randomUUID(),expectedRevision:0,action:{type:'erase.everything'}});
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    const large=await l.request(`${s.path}/actions`,envelope(0,{type:'note.save',taskId:'assign',text:'x'.repeat(33000)}));
    expect(large.status).toBeGreaterThanOrEqual(400);
  });
});
