import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function openTrial(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-test').click();
  await expect(page).toHaveURL(/\/compare\/test\/[a-f0-9-]+/);
  await expect(page.locator('#ticket-A-SPR-103')).toBeVisible();
}

async function dragBefore(page: Page, pane: 'A'|'B', ticket: string, before: string) {
  const handle=page.locator(`#drag-${pane}-${ticket}`);
  const target=page.locator(`#ticket-${pane}-${before}`);
  await handle.scrollIntoViewIfNeeded();
  const sourceBox=await handle.boundingBox();
  if (!sourceBox) throw new Error('Drag handle is not visible');
  await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x+sourceBox.width/2+12,sourceBox.y+sourceBox.height/2+12,{steps:4});
  await target.scrollIntoViewIfNeeded();
  const targetBox=await target.boundingBox();
  if (!targetBox) throw new Error('Drop target is not visible');
  await page.mouse.move(targetBox.x+targetBox.width/2,targetBox.y+5,{steps:16});
  await expect(page.getByTestId('drop-indicator')).toBeVisible();
  await page.mouse.up();
}

async function queue(page:Page,pane:string,owner:string) {
  return page.locator(`#queue-${pane}-${owner} [data-ticket]`).evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).dataset.ticket));
}

async function moveWithControls(page:Page,pane:string,ticket:string,owner:string,before:string) {
  await page.locator(`#move-${pane}-${ticket}`).click();
  await page.locator('#move-owner').selectOption(owner);
  await page.locator('#move-position').selectOption(before);
  await page.locator('#move-confirm').focus();
  await page.keyboard.press('Enter');
}

test('A pointer assignment persists; reset and undo leave B unchanged', async ({page})=>{
  await openTrial(page);
  await dragBefore(page,'A','SPR-103','SPR-107');
  await expect.poll(()=>queue(page,'A','leo')).toEqual(['SPR-102','SPR-103','SPR-107']);
  await expect(page.locator('#ticket-B-SPR-103')).toBeVisible();
  await page.reload();
  await expect.poll(()=>queue(page,'A','leo')).toEqual(['SPR-102','SPR-103','SPR-107']);
  await page.locator('[data-pane="A"] [data-action="reset"]').click();
  await expect.poll(()=>queue(page,'A','leo')).toEqual(['SPR-102','SPR-107']);
  await page.locator('[data-pane="A"] [data-action="undo"]').click();
  await expect.poll(()=>queue(page,'A','leo')).toEqual(['SPR-102','SPR-103','SPR-107']);
  await expect(page.locator('#queue-B-backlog #ticket-B-SPR-103')).toBeVisible();
});

test('B pointer assignment works after expansion; keyboard priority is independent', async ({page})=>{
  await openTrial(page);
  const leo=page.locator('#toggle-B-leo');
  if(await leo.getAttribute('aria-expanded')==='false') await leo.click();
  await dragBefore(page,'B','SPR-103','SPR-107');
  await expect.poll(()=>queue(page,'B','leo')).toEqual(['SPR-102','SPR-103','SPR-107']);
  await expect.poll(()=>queue(page,'A','leo')).toEqual(['SPR-102','SPR-107']);
  await moveWithControls(page,'A','SPR-104','maya','SPR-101');
  await expect.poll(()=>queue(page,'A','maya')).toEqual(['SPR-104','SPR-101']);
  await expect(page.getByTestId('vote-A')).toBeEnabled();
});

test('Escape and cross-pane drops cancel without moving a ticket', async ({page})=>{
  await openTrial(page);
  const source=await page.locator('#drag-A-SPR-103').boundingBox();
  const target=await page.locator('#ticket-A-SPR-107').boundingBox();
  if(!source||!target) throw new Error('Missing drag target');
  await page.mouse.move(source.x+5,source.y+5); await page.mouse.down();
  await page.mouse.move(target.x+10,target.y+5,{steps:15});
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('#queue-A-backlog #ticket-A-SPR-103')).toBeVisible();
  const wrong=await page.locator('#ticket-B-SPR-103').boundingBox();
  if(!wrong) throw new Error('Missing other pane');
  await page.mouse.move(source.x+5,source.y+5); await page.mouse.down();
  await page.mouse.move(wrong.x+10,wrong.y+10,{steps:15}); await page.mouse.up();
  await expect(page.locator('#queue-A-backlog #ticket-A-SPR-103')).toBeVisible();
  await expect.poll(()=>queue(page,'A','leo')).toEqual(['SPR-102','SPR-107']);
});

test('notes and ballots survive reload without automatic advancement or selection', async({page})=>{
  await openTrial(page);
  await page.getByTestId('note').fill('TEST FIXTURE — prefer the visible insertion cue.');
  await page.getByTestId('vote-A').click();
  await expect(page.getByTestId('next-task')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('next-task')).toBeVisible();
  await page.getByTestId('next-task').click();
  await expect(page.getByTestId('vote-B')).toBeEnabled();
  await page.getByTestId('note').fill('TEST FIXTURE — second comparison');
  await page.getByTestId('vote-skip').click();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('select-A')).toBeVisible();
  await expect(page.getByText('No widget selected', {exact:false})).toBeVisible();
  await expect(page.getByText('TEST FIXTURE — prefer the visible insertion cue.',{exact:false})).toBeVisible();
});

test('failed ballot preserves the note and retries the same pending command',async({page})=>{
  await openTrial(page);
  let blocked=true;
  await page.route('**/actions', async route=>{
    const data=route.request().postDataJSON();
    if(blocked && data?.action?.type==='decision.record') await route.abort('failed');
    else await route.continue();
  });
  await page.getByTestId('note').fill('TEST FIXTURE — retain this unsaved note');
  await page.getByTestId('vote-B').click();
  await expect(page.getByTestId('retry-save')).toBeVisible();
  await expect(page.getByTestId('note')).toHaveValue('TEST FIXTURE — retain this unsaved note');
  blocked=false;
  await page.getByTestId('retry-save').click();
  await expect(page.getByTestId('next-task')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('next-task')).toBeVisible();
});

test('explicit test selection opens a usable standalone widget',async({page})=>{
  await openTrial(page);
  await page.getByTestId('finish').click();
  await page.getByTestId('select-B').click();
  await expect(page).toHaveURL(/\/chosen\/test\/[a-f0-9-]+/);
  await expect(page.locator('#pane-chosen')).toBeVisible();
  await moveWithControls(page,'chosen','SPR-103','leo','SPR-107');
  await expect.poll(()=>queue(page,'chosen','leo')).toEqual(['SPR-102','SPR-103','SPR-107']);
});

test('recording-size and narrow sequential views are usable',async({page})=>{
  await openTrial(page);
  await mkdir('lesson/captures',{recursive:true});
  await page.screenshot({path:'lesson/captures/01-seed-pair.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByText(/Sequential comparison/)).toBeVisible();
  await page.locator('#view-B').click();
  await expect(page.locator('#ticket-B-SPR-103')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'lesson/captures/06-narrow-sequential.png',fullPage:true});
});
