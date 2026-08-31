import { test, expect, type Page } from '@playwright/test';

interface ReviewState {
  ready: boolean;
  revision: number;
  selectedId: string | null;
  index: number;
  total: number;
  previewStatus: string;
  options: { id: string; name: string; number: string }[];
}

interface ReviewResult {
  ok: boolean;
  protocol: string;
  state: ReviewState;
  error?: { code: string; message: string };
  changed?: boolean;
  timedOut?: boolean;
  preview?: {
    sample: { state: { ready: boolean; response: string | null; notes: Record<string, string> } } | null;
  };
}

type ReviewAction = 'select' | 'next' | 'previous' | 'focus-review';
type ReviewWindow = typeof window & {
  chromeMockups: {
    inspect(): ReviewResult;
    act(request: { action: ReviewAction; expectedRevision?: number; id?: string }): ReviewResult;
    wait(request: { afterRevision: number; timeoutMs: number }): Promise<ReviewResult>;
  };
};

function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function protectTournaments(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/v2/tournaments**', async route => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().url());
      await route.abort();
    } else {
      await route.continue();
    }
  });
  return writes;
}

async function inspect(page: Page) {
  return page.evaluate(() => (window as ReviewWindow).chromeMockups.inspect());
}

async function ready(page: Page, selectedId?: string) {
  await expect.poll(() => page.evaluate(id => {
    const state = (window as ReviewWindow).chromeMockups?.inspect().state;
    return state?.ready && state.previewStatus === 'ready' && (!id || state.selectedId === id);
  }, selectedId)).toBe(true);
  const { state } = await inspect(page);
  await expect(page.locator('#design-preview')).toBeVisible();
  await expect(page.frameLocator('#design-preview').locator('body')).toHaveAttribute('data-design', state.selectedId!);
  await expect.poll(() => page.frameLocator('#design-preview').locator('iframe[data-candidate]').evaluateAll(elements =>
    elements.length === 2 && elements.every(element => {
      const frame = element as HTMLIFrameElement;
      return frame.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.pathname === new URL(frame.src).pathname;
    }),
  )).toBe(true);
  await expect(page.locator('#design-name')).toHaveText(state.options[state.index].name);
  expect(new URL(page.url()).hash).toBe(`#${state.selectedId}`);
  return state;
}

async function unchanged(page: Page, state: ReviewState) {
  // Give forwarded iframe events a chance to arrive, rather than taking an immediate snapshot.
  const result = await page.evaluate(afterRevision => (window as ReviewWindow).chromeMockups.wait({ afterRevision, timeoutMs: 100 }), state.revision);
  expect(result).toMatchObject({
    ok: true, changed: false, timedOut: true,
    state: { selectedId: state.selectedId, revision: state.revision, previewStatus: 'ready' },
  });
}

test('arrow browsing reaches all eighteen designs and wraps from focused preview and candidate buttons', async ({ page }) => {
  const writes = await protectTournaments(page);
  await page.goto('/mockups');
  const initial = await ready(page);
  expect(initial.total).toBe(18);
  expect(initial.index).toBe(0);
  const first = initial.options[0].id;
  const last = initial.options[initial.options.length - 1].id;

  await page.getByRole('button', { name: 'Next design', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await ready(page, last);
  await page.keyboard.press('ArrowRight');
  await ready(page, first);

  for (const option of initial.options.slice(1)) {
    const button = page.frameLocator('#design-preview').locator('button[data-vote="left"]:not(:disabled)');
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await ready(page, option.id);
  }

  const leftButton = page.frameLocator('#design-preview').frameLocator('iframe[data-candidate="left"]').locator('button:not(:disabled)').first();
  await leftButton.focus();
  await expect(leftButton).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await ready(page, first);

  const rightButton = page.frameLocator('#design-preview').frameLocator('iframe[data-candidate="right"]').locator('button:not(:disabled)').first();
  await rightButton.focus();
  await expect(rightButton).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  const final = await ready(page, last);
  await unchanged(page, final);
  expect((await inspect(page)).preview?.sample?.state.response).toBeNull();
  expect(writes).toEqual([]);
});

test('editing retains arrows while modified and repeated keys never advance the reviewer', async ({ page }) => {
  const writes = await protectTournaments(page);
  await page.goto('/mockups');
  let state = await ready(page);
  const preview = page.frameLocator('#design-preview');
  const note = preview.locator('textarea[data-note="left"]');
  await note.fill('Draft note');
  await page.keyboard.press('ArrowLeft');
  await expect(note).toBeFocused();
  expect(await note.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(9);
  await unchanged(page, state);
  await page.keyboard.press('ArrowRight');
  expect(await note.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(10);
  await expect(note).toHaveValue('Draft note');
  await unchanged(page, state);

  const select = preview.frameLocator('iframe[data-candidate="left"]').locator('#owner-select');
  await select.focus();
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    await page.keyboard.press(key);
    await expect(select).toBeFocused();
    await unchanged(page, state);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#next-design')).toBeFocused();

  const surfaces = [
    page.locator('#next-design'),
    preview.locator('button[data-vote="left"]:not(:disabled)'),
    preview.frameLocator('iframe[data-candidate="left"]').locator('button:not(:disabled)').first(),
  ];
  for (const surface of surfaces) {
    await surface.focus();
    await expect(surface).toBeFocused();
    for (const modifier of ['Alt', 'Control', 'Meta', 'Shift']) {
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        await page.keyboard.press(`${modifier}+${key}`);
        await unchanged(page, state);
      }
    }
  }

  for (const key of ['ArrowRight', 'ArrowLeft']) {
    for (const surface of surfaces) {
      // The first down is a real navigation; a second down without an up is repeat=true.
      await surface.focus();
      const delta = key === 'ArrowRight' ? 1 : -1;
      const target = state.options[(state.index + delta + state.total) % state.total].id;
      await page.keyboard.down(key);
      try {
        state = await ready(page, target);
        await surface.focus();
        await expect(surface).toBeFocused();
        await page.keyboard.down(key);
        await unchanged(page, state);
      } finally {
        await page.keyboard.up(key);
      }
    }
  }
  expect(writes).toEqual([]);
});

test('revision guards and readiness waits protect selection; sample responses never write tournaments', async ({ page }) => {
  const writes = await protectTournaments(page);
  const catalog = latch();
  await page.route('**/mockups.json', async route => {
    await catalog.promise;
    await route.continue();
  });
  await page.goto('/mockups', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as ReviewWindow).chromeMockups));
  const loading = await inspect(page);
  expect(loading).toMatchObject({ protocol: 'this-or-that/chrome-mockups/v2', state: { ready: false, selectedId: null } });
  expect(await page.evaluate(expectedRevision => (window as ReviewWindow).chromeMockups.act({ action: 'next', expectedRevision }), loading.state.revision)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });

  // Retain the real wait promise without awaiting it until the real catalog request is released.
  const pending = await page.evaluateHandle(afterRevision => ({ result: (window as ReviewWindow).chromeMockups.wait({ afterRevision, timeoutMs: 10000 }) }), loading.state.revision);
  catalog.release();
  const becameReady = await pending.evaluate(async ({ result }) => result);
  await pending.dispose();
  expect(becameReady).toMatchObject({ ok: true, changed: true, timedOut: false, state: { ready: true } });
  const state = await ready(page, becameReady.state.selectedId!);
  const next = state.options[1].id;

  for (const action of ['select', 'next', 'previous', 'focus-review'] as const) {
    const rejected = await page.evaluate(({ action, id, staleRevision }) => {
      const api = (window as ReviewWindow).chromeMockups;
      return [api.act({ action, id }), api.act({ action, id, expectedRevision: staleRevision })];
    }, { action, id: next, staleRevision: loading.state.revision });
    expect(rejected[0]).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' }, state: { selectedId: state.selectedId, revision: state.revision } });
    expect(rejected[1]).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' }, state: { selectedId: state.selectedId, revision: state.revision } });
  }
  await unchanged(page, state);

  const preview = page.frameLocator('#design-preview');
  await preview.locator('textarea[data-note="left"]').fill('Local sample only');
  for (const response of ['left', 'right', 'skip', 'like', 'hate']) {
    const button = preview.locator(`button[data-vote="${response}"]:not(:disabled)`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(preview.locator('[data-status]')).toContainText('No ranking was recorded.');
    expect((await inspect(page)).preview?.sample?.state).toMatchObject({ response, notes: { left: 'Local sample only' } });
    await unchanged(page, state);
    expect(writes).toEqual([]);
  }

  const selected = await page.evaluate(({ id, expectedRevision }) => (window as ReviewWindow).chromeMockups.act({ action: 'select', id, expectedRevision }), { id: next, expectedRevision: state.revision });
  expect(selected.ok).toBe(true);
  const nextState = await ready(page, next);
  const changed = await page.evaluate(afterRevision => (window as ReviewWindow).chromeMockups.wait({ afterRevision, timeoutMs: 0 }), state.revision);
  expect(changed).toMatchObject({ ok: true, changed: true, timedOut: false, state: { selectedId: next, revision: nextState.revision } });
  await page.locator('#next-design').focus();
  await page.keyboard.press('ArrowLeft');
  const restored = await ready(page, state.selectedId!);
  await expect(preview.locator('textarea[data-note="left"]')).toHaveValue('');
  expect((await inspect(page)).preview?.sample?.state).toMatchObject({ response: null, notes: { left: '' } });
  await unchanged(page, restored);
  expect(writes).toEqual([]);
});
