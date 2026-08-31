import { test, expect, type Page } from '@playwright/test';
import { parseSessionDocument } from '../../shared/validate';
import type { Action } from '../../shared/contract';

test.beforeEach(({page})=>{
  page.on('dialog',async dialog=>{expect(dialog.type()).toBe('beforeunload');await dialog.accept();});
});

function isAction(value: unknown, type: string): boolean {
  return typeof value === 'object' && value !== null && 'action' in value && typeof value.action === 'object' && value.action !== null && 'type' in value.action && value.action.type === type;
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function trial(page: Page, mode: 'test' | 'rehearsal' = 'test') {
  await page.goto('/');
  await page.getByTestId(mode === 'test' ? 'start-test' : 'start-rehearsal').click();
  await expect(page).toHaveURL(new RegExp(`/compare/${mode}/`));
  await expect(page.locator('#ticket-A-SPR-103')).toBeVisible();
}
async function state(page: Page) {
  const path = new URL(page.url()).pathname.replace(/^\/(compare|chosen)\//, '/api/v1/sessions/');
  const response = await page.request.get(path);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || !('state' in value)) throw new Error('No inspected state');
  return parseSessionDocument(value.state);
}
async function externalAction(page: Page, action: Action) {
  const current = await state(page);
  const response = await page.request.get('/api/v1/discover');
  const discovery: unknown = await response.json();
  if (!discovery || typeof discovery !== 'object' || !('nonce' in discovery) || typeof discovery.nonce !== 'string') throw new Error('No mutation nonce');
  const saved = await page.request.post(`/api/v1/sessions/${current.ref.mode}/${current.ref.id}/actions`, { headers: {'x-tot-client':'agent','x-tot-nonce':discovery.nonce}, data:{requestId:crypto.randomUUID(),expectedRevision:current.revision,action} });
  expect(saved.status()).toBe(200);
}
async function pointerStart(page: Page, pane: string, ticket: string) {
  const handle = page.locator(`#drag-${pane}-${ticket}`);
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Missing handle');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+15,box.y+box.height/2+15,{steps:3});
  await expect(page.locator('.drag-ghost')).toBeVisible();
}
async function moveDialog(page: Page, pane: string, ticket: string, owner: string, before: string) {
  await page.locator(`#move-${pane}-${ticket}`).click();
  await page.locator('#move-owner').selectOption(owner);
  await page.locator('#move-position').selectOption(before);
  await page.locator('#move-confirm').click();
  await expect(page.locator('#move-dialog')).toHaveCount(0);
  await expect(page.locator('.save-status')).toContainText('Saved');
}

test('Finish cannot seal an older note while a newer draft is typed', async ({page}) => {
  await trial(page);
  await page.clock.install();
  const reached=latch(), release=latch(); let hold=true;
  await page.route('**/actions',async route=>{
    if (hold && isAction(route.request().postDataJSON(),'note.save')) { hold=false; reached.release(); await release.promise; }
    await route.continue();
  });
  await page.getByTestId('note').fill('TEST FIXTURE — first draft');
  await page.clock.fastForward(700);
  await reached.promise;
  const expected='TEST FIXTURE — latest draft';
  await expect(page.getByTestId('note')).toBeEditable();
  await page.getByTestId('note').fill(expected);
  const finishing=page.getByTestId('finish').click();
  release.release();
  await finishing;
  await expect(page.getByTestId('select-A')).toBeVisible();
  expect((await state(page)).comparison.finish?.snapshot.drafts.assign).toBe(expected);
});

test('prepared task transition flushes or protects the latest note', async({page})=>{
  await trial(page,'rehearsal');
  const reached=latch(), release=latch(); let hold=true;
  await page.route('**/actions',async route=>{
    if(hold&&isAction(route.request().postDataJSON(),'note.save')) {hold=false;reached.release();await release.promise;}
    await route.continue();
  });
  await page.getByTestId('note').fill('TEST FIXTURE — old task draft');
  await page.getByRole('button',{name:'Change the priority',exact:true}).click();
  await reached.promise;
  let expected='TEST FIXTURE — old task draft';
  if(await page.getByTestId('note').isEditable()) {expected='TEST FIXTURE — final old task draft';await page.getByTestId('note').fill(expected);}
  release.release();
  await expect.poll(async()=>(await state(page)).comparison.taskId).toBe('prioritize');
  expect((await state(page)).comparison.drafts.assign).toBe(expected);
  await expect(page.locator('.recovery-banner')).toHaveCount(0);
});

test('explicit refresh shows an agent move and retains a local draft', async({page})=>{
  await trial(page,'rehearsal');
  await externalAction(page,{type:'pane.move',paneId:'A',expectedPaneRevision:0,ticketId:'SPR-103',fromOwnerId:'backlog',toOwnerId:'leo',beforeTicketId:'SPR-107'});
  await page.clock.install();
  await page.getByTestId('note').fill('TEST FIXTURE — preserve during refresh');
  await page.getByTestId('refresh-state').click();
  await expect(page.locator('#queue-A-leo #ticket-A-SPR-103')).toBeVisible();
  await expect(page.getByTestId('note')).toHaveValue('TEST FIXTURE — preserve during refresh');
  await expect(page.locator('#queue-B-backlog #ticket-B-SPR-103')).toBeVisible();
  expect((await state(page)).comparison.drafts.assign).toBe('');
  await page.getByRole('button',{name:'Save note now',exact:true}).click();
  await expect.poll(async()=>(await state(page)).comparison.drafts.assign).toBe('TEST FIXTURE — preserve during refresh');
});

test('autosave does not interrupt a held drag',async({page})=>{
  await page.clock.install();
  await trial(page,'rehearsal');
  await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.getByTestId('note').fill('TEST FIXTURE — note before dragging');
  await pointerStart(page,'A','SPR-103');
  const target=await page.locator('#ticket-A-SPR-107').boundingBox();
  if(!target)throw new Error('No target');
  await page.mouse.move(target.x+target.width/2,target.y+5,{steps:8});
  await expect(page.getByTestId('drop-indicator')).toBeVisible();
  // Advance the real UI's debounce deterministically while pointer capture is active.
  await page.clock.fastForward(900);
  await expect(page.getByTestId('drop-indicator')).toBeVisible();
  await page.mouse.up();
  await expect.poll(async()=>(await state(page)).comparison.panes.A.queues.leo).toEqual(['SPR-102','SPR-103','SPR-107']);
  await page.clock.fastForward(700);
  await expect.poll(async()=>(await state(page)).comparison.drafts.assign).toBe('TEST FIXTURE — note before dragging');
});

test('stationary hover never leaves an invalid append marker',async({page})=>{
  await trial(page);
  await pointerStart(page,'B','SPR-103');
  const row=await page.locator('#toggle-B-leo').boundingBox();if(!row)throw new Error('No row');
  await page.mouse.move(row.x+row.width/2,row.y+row.height/2,{steps:8});
  await expect(page.locator('#toggle-B-leo')).toHaveAttribute('aria-expanded','true');
  const marker=page.getByTestId('drop-indicator');
  const label=await marker.count() ? await marker.textContent() : null;
  if(label!==null) expect(label).not.toContain('hold to expand');
  const before=await state(page);
  await page.mouse.up();
  await expect(page.locator('.save-status')).toContainText('Saved');
  const after=await state(page);
  if(label===null) expect(after.revision).toBe(before.revision);
  else expect(after.comparison.panes.B.queues.leo.at(-1)).toBe('SPR-103');
});

test('normal saving does not display danger recovery or shift the workspace',async({page})=>{
  await trial(page);
  const reached=latch(), release=latch();
  await page.route('**/actions',async route=>{
    if(isAction(route.request().postDataJSON(),'pane.move')) {reached.release();await release.promise;}
    await route.continue();
  });
  const top=(await page.locator('#pane-A').boundingBox())?.y;
  await page.locator('#move-A-SPR-103').click();
  await page.locator('#move-owner').selectOption('leo');
  await page.locator('#move-position').selectOption('SPR-107');
  await page.locator('#move-confirm').click();
  await reached.promise;
  await expect(page.locator('.save-status')).toContainText('Saving');
  await expect(page.locator('.recovery-banner')).toHaveCount(0);
  expect((await page.locator('#pane-A').boundingBox())?.y).toBe(top);
  release.release();
  await expect.poll(async()=>(await state(page)).revision).toBe(1);
});

test('fresh sessions and task changes clear old feedback and restore phase focus',async({page})=>{
  await trial(page,'rehearsal');
  await moveDialog(page,'A','SPR-103','leo','SPR-107');
  await expect(page.locator('#pane-A .pane-live')).toContainText('SPR-103');
  await page.locator('#scroll-A').evaluate(e=>{e.scrollTop=100});
  await page.getByTestId('start-test').click();
  await expect(page).toHaveURL(/\/compare\/test\//);
  await expect(page.locator('#pane-A .pane-live')).not.toContainText('SPR-103');
  expect(await page.locator('#scroll-A').evaluate(e=>e.scrollTop)).toBe(0);
  await page.getByTestId('vote-skip').click();
  await page.getByTestId('next-task').click();
  await expect(page.locator('#task-instruction')).toBeFocused();
  await page.getByTestId('finish').click();
  await expect(page.locator('#finished-heading')).toBeFocused();
});

test('selection reason survives reload without inventing a selection',async({page})=>{
  await trial(page);await page.getByTestId('finish').click();
  await page.getByTestId('selection-reason').fill('TEST FIXTURE — retain this reason without voting');
  await page.reload();
  await expect(page.getByTestId('selection-reason')).toHaveValue('TEST FIXTURE — retain this reason without voting');
  expect((await state(page)).selection).toBeNull();
  let lose=true;
  await page.route('**/actions',async route=>{
    if(lose&&isAction(route.request().postDataJSON(),'selection.commit')) {lose=false;await route.fetch();await route.abort('failed');}
    else await route.continue();
  });
  await page.getByTestId('select-B').click();
  await expect(page.getByTestId('retry-save')).toBeVisible();
  await page.reload();
  await expect.poll(async()=>(await state(page)).selection?.reason).toBe('TEST FIXTURE — retain this reason without voting');
  expect((await state(page)).receipts.filter(r=>r.actionType==='selection.commit')).toHaveLength(1);
});

test('lost post-commit ballot acknowledgment reconciles once through refresh and reload',async({page})=>{
  await trial(page);let lose=true;
  await page.route('**/actions',async route=>{
    if(lose&&isAction(route.request().postDataJSON(),'decision.record')) {lose=false;await route.fetch();await route.abort('failed');}
    else await route.continue();
  });
  await page.getByTestId('note').fill('TEST FIXTURE — server saved but response lost');
  await page.getByTestId('vote-A').click();
  await expect(page.getByTestId('retry-save')).toBeVisible();
  await expect(page.getByTestId('refresh-state')).toBeEnabled();
  await page.getByTestId('refresh-state').click();
  await expect(page.getByTestId('next-task')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('next-task')).toBeVisible();
  const recovered=await state(page);
  expect(recovered.comparison.decisions).toHaveLength(1);
  expect(recovered.comparison.decisions[0].note).toBe('TEST FIXTURE — server saved but response lost');
  expect(recovered.receipts.filter(r=>r.actionType==='decision.record')).toHaveLength(1);
});

test('pointer edge scrolling reaches an initially clipped ticket',async({page})=>{
  await trial(page,'rehearsal');
  await moveDialog(page,'A','SPR-103','leo','SPR-107');
  await pointerStart(page,'A','SPR-105');
  const board=await page.locator('#scroll-A').boundingBox();const lane=await page.locator('#queue-A-leo').boundingBox();
  if(!board||!lane)throw new Error('No scroll geometry');
  await page.mouse.move(lane.x+lane.width/2,board.y+board.height-8,{steps:12});
  await expect.poll(()=>page.locator('#scroll-A').evaluate(e=>e.scrollTop)).toBeGreaterThan(20);
  // Leave the edge before measuring the newly revealed target; scrolling changes its coordinates.
  await page.mouse.move(lane.x+lane.width/2,board.y+board.height/2);
  const target=await page.locator('#ticket-A-SPR-107').boundingBox();if(!target)throw new Error('No revealed target');
  await page.mouse.move(target.x+target.width/2,target.y+5,{steps:6});
  await page.mouse.up();
  await expect.poll(async()=>(await state(page)).comparison.panes.A.queues.leo).toEqual(['SPR-102','SPR-103','SPR-105','SPR-107']);
});

test('unequal-height backlog cards keep left-to-right insertion semantics',async({page})=>{
  await page.route('**/widgets/columns.css',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+'\n#ticket-A-SPR-103 { min-height:180px; }'});
  });
  await trial(page);
  // Synthetic geometry fixture: a wrapped title can make one card taller than its siblings.
  await pointerStart(page,'A','SPR-108');
  const tall=await page.locator('#ticket-A-SPR-103').boundingBox();if(!tall)throw new Error('No tall card');
  const sibling=await page.locator('#ticket-A-SPR-105').boundingBox();
  expect(sibling && tall.height>sibling.height+20).toBe(true);
  await page.mouse.move(tall.x+tall.width*.8,tall.y+tall.height-10,{steps:12});
  await expect(page.getByTestId('drop-indicator')).toContainText('priority 2');
  await page.mouse.up();
  await expect.poll(async()=>(await state(page)).comparison.panes.A.queues.backlog).toEqual(['SPR-103','SPR-108','SPR-105']);
});

test('a complete keyboard-only move retains visible focus',async({page})=>{
  await trial(page);
  for(let step=0;step<35;step++) {
    if(await page.evaluate(()=>document.activeElement?.id==='move-A-SPR-103')) break;
    await page.keyboard.press('Tab');
  }
  await expect(page.locator('#move-A-SPR-103')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#move-owner')).toBeFocused();
  await page.keyboard.press('l');
  await expect(page.locator('#move-owner')).toHaveValue('leo');
  await page.keyboard.press('Tab');await page.keyboard.type('Before SPR-107');
  await expect(page.locator('#move-position')).toHaveValue('SPR-107');
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Enter');
  await expect.poll(async()=>(await state(page)).comparison.panes.A.queues.leo).toEqual(['SPR-102','SPR-103','SPR-107']);
  await expect(page.locator('#move-A-SPR-103')).toBeFocused();
  const control=await page.locator('#move-A-SPR-103').boundingBox();const board=await page.locator('#scroll-A').boundingBox();
  expect(control&&board&&control.y>=board.y&&control.y+control.height<=board.y+board.height).toBe(true);
  expect((await state(page)).comparison.decisions).toHaveLength(0);
});

test('supplementary Unicode text uses the same character limit as the API',async({page})=>{
  await trial(page,'rehearsal');
  const text='TEST '+String.fromCodePoint(0x1D400).repeat(1900);
  await page.getByTestId('note').fill(text);
  await expect(page.getByTestId('note')).toHaveValue(text);
  await expect.poll(async()=>(await state(page)).comparison.drafts.assign).toBe(text);
  const overlong=text+'x'.repeat(200);
  await page.getByTestId('note').fill(overlong);
  await expect(page.getByTestId('note')).toHaveValue(overlong);
  await page.reload();
  await expect(page.getByTestId('note')).toHaveValue(overlong);
  expect((await state(page)).comparison.drafts.assign).toBe(text);
});
