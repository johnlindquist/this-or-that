import { test, expect, type Page } from '@playwright/test';
import type { Tournament } from '../../tournament/ranking';

type AppearanceMode = 'system' | 'light' | 'dark';
interface AppearanceState {
  mode: AppearanceMode;
  resolved: 'light' | 'dark';
  revision: number;
  persistence: 'default' | 'saved' | 'unavailable';
  error: { code: string; message: string } | null;
}
interface AppearanceResult {
  ok: boolean;
  protocol: string;
  state: AppearanceState;
  error?: { code: string; message: string };
  changed?: boolean;
}
interface NavigationState {
  id: 'navigation-toggle';
  role: 'button';
  expanded: boolean;
  revision: number;
  available: boolean;
  controls: string[];
}
interface NavigationResult {
  ok: boolean;
  navigation: NavigationState;
  error?: { code: string; message: string };
}
type ComparisonSide = 'left' | 'right' | null;
interface ComparisonInteraction {
  available: boolean;
  hoveredSide: ComparisonSide;
  focusedSide: ComparisonSide;
  emphasizedSide: ComparisonSide;
}
interface LiveSnapshot {
  state: Tournament;
  view: string;
  busy: boolean;
  dirtyNotes: Record<string, string>;
  comparisonNotes: Record<string, string>;
  appearance: AppearanceState;
  navigation: NavigationState;
  comparisonInteraction: ComparisonInteraction;
  focusedFrame: string | null;
  shortcutsAvailable: boolean;
}
type LiveWindow = typeof window & {
  tournament: {
    inspect(): LiveSnapshot;
    setNavigation(request: { expectedRevision?: number; open: boolean }): NavigationResult;
    appearance: {
      inspect(): AppearanceResult;
      act(request: { expectedRevision?: number; mode: string }): AppearanceResult;
      wait(request: { afterRevision: number; timeoutMs: number }): Promise<AppearanceResult>;
    };
  };
};

test.use({ screenshot: 'off' });
test.beforeEach(async ({ context }) => {
  // Never let a regression in URL handling create human preference evidence.
  await context.route('**/api/v2/tournaments', async route => {
    const request = route.request();
    if (request.method() === 'POST' && request.postDataJSON()?.mode !== 'rehearsal') {
      await route.abort('blockedbyclient');
      throw new Error('Folio tests may create rehearsal sessions only');
    }
    await route.continue();
  });
});

async function inspect(page: Page) {
  return page.evaluate(() => (window as LiveWindow).tournament.inspect());
}

async function appearance(page: Page) {
  return page.evaluate(() => (window as LiveWindow).tournament.appearance.inspect());
}

async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const live = (window as LiveWindow).tournament?.inspect?.();
    return Boolean(live?.state?.pair && live.view === 'compare' && !live.busy);
  })).toBe(true);
  await expect(page.locator('#choose-left')).toBeEnabled();
  await expect(page.locator('#choose-right')).toBeEnabled();
  const live = await inspect(page);
  expect(live.state.mode).toBe('rehearsal');
  expect(new URL(page.url()).searchParams.get('rehearsal')).toBe('1');
  expect(new URL(page.url()).searchParams.get('session')).toBe(live.state.id);
  return live;
}

async function openRehearsal(page: Page) {
  await page.goto('/?rehearsal=1');
  return ready(page);
}

async function openNavigation(page: Page) {
  const toggle = page.getByRole('button', { name: 'More', exact: true });
  if (!(await inspect(page)).navigation.expanded) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const navigation = page.getByRole('navigation', { name: 'Tournament', exact: true });
  await expect(navigation).toBeVisible();
  return navigation;
}

async function savedState(page: Page, id: string) {
  const response = await page.request.get(`/api/v2/tournaments/${id}`);
  expect(response.ok()).toBe(true);
  const result = await response.json() as { ok: boolean; state: Tournament };
  expect(result.ok).toBe(true);
  return result.state;
}

async function unchanged(page: Page, before: Tournament) {
  expect(await inspect(page)).toMatchObject({ state: before, busy: false });
  expect(await savedState(page, before.id)).toEqual(before);
}

async function changedComparison(page: Page, revision: number, count: number) {
  await expect.poll(async () => {
    const live = await inspect(page);
    return { revision: live.state.revision, count: live.state.comparisons.length, busy: live.busy };
  }).toEqual({ revision, count, busy: false });
  return ready(page);
}

test('appearance selections persist while only System follows color-scheme changes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ colorScheme: 'light' });
  const before = await openRehearsal(page);
  expect(before.state.candidates).toHaveLength(22);
  const app = (await page.locator('#app').boundingBox())!;
  expect(app.x).toBeGreaterThanOrEqual(0);
  expect(app.x).toBeLessThanOrEqual(16);
  expect(1920 - app.x - app.width).toBeGreaterThanOrEqual(0);
  expect(1920 - app.x - app.width).toBeLessThanOrEqual(16);
  const frames = await page.locator('.pair iframe').evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }));
  expect(frames).toHaveLength(2);
  for (const frame of frames) {
    expect(frame.width).toBeGreaterThanOrEqual(880);
    expect(frame.height).toBeGreaterThanOrEqual(850);
    expect(frame.y).toBeLessThanOrEqual(184);
  }
  expect(Math.abs(frames[0].y - frames[1].y)).toBeLessThanOrEqual(1);
  expect(frames[1].x).toBeGreaterThanOrEqual(frames[0].x + frames[0].width);
  for (const side of ['left', 'right'] as const) {
    const candidate = before.state.candidates.find(item => item.id === before.state.pair![side])!;
    const frame = page.locator(`#frame-${side}`);
    await expect(frame).toHaveAttribute('src', candidate.src);
    await expect(frame).toHaveAttribute('title', candidate.name);
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    await expect(page.frameLocator(`#frame-${side}`).locator('body')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: `Choose ${candidate.name}`, exact: true })).toBeVisible();
    await expect(page.locator(`textarea[data-note="${candidate.id}"]`)).toBeVisible();
  }
  const select = page.locator('#appearance-mode');
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveText(['System', 'Light', 'Dark']);
  expect(await appearance(page)).toMatchObject({
    ok: true, protocol: 'this-or-that/appearance/v1',
    state: { mode: 'system', resolved: 'light', persistence: 'default', error: null },
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  for (const mode of ['dark', 'light'] as const) {
    await select.selectOption(mode);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    expect(await page.evaluate(() => localStorage.getItem('tot-appearance'))).toBe(mode);
    await page.reload();
    await ready(page);
    await expect(select).toHaveValue(mode);
    const explicit = await appearance(page);
    expect(explicit.state).toMatchObject({ mode, resolved: mode, persistence: 'saved', error: null });
    await page.emulateMedia({ colorScheme: mode });
    await page.emulateMedia({ colorScheme: mode === 'dark' ? 'light' : 'dark' });
    expect(await page.evaluate(afterRevision => (window as LiveWindow).tournament.appearance.wait({ afterRevision, timeoutMs: 100 }), explicit.state.revision))
      .toMatchObject({ ok: true, changed: false, state: explicit.state });
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
  }

  await select.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    expect((await appearance(page)).state).toMatchObject({ mode: 'system', resolved: colorScheme });
  }
  await unchanged(page, before.state);
});

test('candidate hover and focus expose one matching cue without changing previews or rankings', async ({ page, context }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const before = await openRehearsal(page);
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);
  const retained = await page.evaluateHandle(() => ['left', 'right'].map(side => {
    const node = document.getElementById(`frame-${side}`) as HTMLIFrameElement;
    const doc = node.contentDocument!;
    doc.body.dataset.folioScratch = side;
    const bodyStyle = getComputedStyle(doc.body);
    return {
      side, node, doc, win: node.contentWindow,
      background: bodyStyle.backgroundColor, color: bodyStyle.color,
      rootStyle: doc.documentElement.getAttribute('style'), bodyStyle: doc.body.getAttribute('style'),
    };
  }));
  const expectRetained = async () => {
    expect(await retained.evaluate(frames => frames.every(({ side, node, doc, win, background, color, rootStyle, bodyStyle }) =>
      document.getElementById(`frame-${side}`) === node && node.contentDocument === doc &&
      node.contentWindow === win && doc.body.dataset.folioScratch === side &&
      getComputedStyle(doc.body).backgroundColor === background && getComputedStyle(doc.body).color === color &&
      doc.documentElement.getAttribute('style') === rootStyle && doc.body.getAttribute('style') === bodyStyle)))
      .toBe(true);
    await unchanged(page, before.state);
  };
  const palette = async () => page.locator('.pair .candidate').evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    const probe = document.createElement('span');
    probe.hidden = true;
    node.append(probe);
    const resolve = (token: string) => {
      probe.style.color = style.getPropertyValue(token);
      return getComputedStyle(probe).color;
    };
    const colors = { paper: resolve('--paper'), wash: resolve('--accent-wash'), line: resolve('--line'), accent: resolve('--accent') };
    probe.remove();
    return { side: node.getAttribute('data-side'), ...colors };
  }));
  let colors = await palette();
  const expectCue = async (hoveredSide: ComparisonSide, focusedSide: ComparisonSide) => {
    const emphasizedSide = hoveredSide ?? focusedSide;
    await expect.poll(() => page.evaluate(() => ({
      interaction: (window as LiveWindow).tournament.inspect().comparisonInteraction,
      styles: [...document.querySelectorAll('.pair .candidate')].map(node => ({
        background: getComputedStyle(node).backgroundColor,
        border: getComputedStyle(node.querySelector('.frame-wrap')!).borderTopColor,
      })),
    }))).toEqual({
      interaction: { available: true, hoveredSide, focusedSide, emphasizedSide },
      styles: colors.map(color => ({
        background: color.side === emphasizedSide ? color.wash : color.paper,
        border: color.side === emphasizedSide ? color.accent : color.line,
      })),
    });
  };
  const outsidePair = async () => page.locator('.topbar').hover({ position: { x: 8, y: 8 } });
  for (const mode of ['light', 'dark'] as const) {
    await page.locator('#appearance-mode').selectOption(mode);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    colors = await palette();
    expect(colors).toHaveLength(2);
    expect(colors[0].wash).not.toBe(colors[1].wash);
    for (const color of colors) expect(color.wash).not.toBe(color.paper);
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      for (const side of ['left', 'right']) {
        const candidate = page.locator(`.candidate[data-side="${side}"]`);
        const duration = reducedMotion === 'reduce' ? '0s' : '0.16s';
        await expect(candidate).toHaveCSS('transition-duration', duration);
        await expect(candidate.locator('.frame-wrap')).toHaveCSS('transition-duration', duration);
        if (reducedMotion === 'no-preference') {
          await expect(candidate).toHaveCSS('transition-property', 'background-color');
          await expect(candidate.locator('.frame-wrap')).toHaveCSS('transition-property', 'border-color');
        }
      }
      await outsidePair();
      await page.locator('#appearance-mode').evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
      await expectCue(null, null);
      await page.locator('#choose-right').evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
      await expectCue(null, 'right');
      // Hover the actual embedded documents, not just the surrounding card header.
      await page.locator('#frame-left').hover({ position: { x: 64, y: 64 } });
      await expectCue('left', 'right');
      await page.locator('#frame-right').hover({ position: { x: 64, y: 64 } });
      await expectCue('right', 'right');
      await page.locator(`textarea[data-note="${before.state.pair!.left}"]`).evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
      await expectCue('right', 'left');
      await outsidePair();
      await expectCue(null, 'left');
      await page.locator('#frame-right').evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
      await expectCue(null, 'right');
      expect((await inspect(page)).focusedFrame).toBe('frame-right');
      await expectRetained();
    }
  }

  // Native Chromium touch emulation changes the existing MediaQueryList too.
  const touch = await context.newCDPSession(page);
  try {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
    await page.locator('#choose-right').evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
    await page.locator('#frame-left').hover({ position: { x: 64, y: 64 } });
    await expectCue(null, 'right');
    await page.locator('#choose-left').evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
    await page.locator('#frame-right').hover({ position: { x: 64, y: 64 } });
    await expectCue(null, 'left');
    await page.locator('#appearance-mode').evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
    await expectCue(null, null);
    await expectRetained();
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await touch.detach();
    await retained.dispose();
  }
  await (await openNavigation(page)).getByRole('button', { name: 'All candidates' }).click();
  await expect(page.getByRole('heading', { name: '22 different approaches' })).toBeVisible();
  expect((await inspect(page)).comparisonInteraction).toEqual({
    available: false, hoveredSide: null, focusedSide: null, emphasizedSide: null,
  });
  await unchanged(page, before.state);
});

test('appearance and More retain candidate documents and drafts; control keys never score or jump to feedback', async ({ page }) => {
  const before = await openRehearsal(page);
  const pair = before.state.pair!;
  const leftNote = page.locator(`textarea[data-note="${pair.left}"]`);
  const rightNote = page.locator(`textarea[data-note="${pair.right}"]`);
  await leftNote.fill('Left draft stays in place');
  await rightNote.fill('Right draft stays in place');
  await page.locator('#pair-note').fill('Unsubmitted comparison feedback');
  const retained = await page.evaluateHandle(() => ({
    frames: ['left', 'right'].map(side => {
      const node = document.getElementById(`frame-${side}`) as HTMLIFrameElement;
      const doc = node.contentDocument!;
      doc.body.dataset.folioScratch = side;
      return { side, node, doc, win: node.contentWindow };
    }),
    notes: [...document.querySelectorAll('textarea[data-note], #pair-note')],
  }));
  const select = page.locator('#appearance-mode');
  for (const mode of ['dark', 'light']) {
    await select.selectOption(mode);
    expect(await retained.evaluate(({ frames, notes }) => ({
      frames: frames.every(({ side, node, doc, win }) =>
        document.getElementById(`frame-${side}`) === node && node.contentDocument === doc &&
        node.contentWindow === win && doc.body.dataset.folioScratch === side),
      notes: notes.every(node => document.getElementById(node.id) === node),
    }))).toEqual({ frames: true, notes: true });
    await expect(leftNote).toHaveValue('Left draft stays in place');
    await expect(rightNote).toHaveValue('Right draft stays in place');
    await expect(page.locator('#pair-note')).toHaveValue('Unsubmitted comparison feedback');
    expect(await inspect(page)).toMatchObject({
      dirtyNotes: { [pair.left]: 'Left draft stays in place', [pair.right]: 'Right draft stays in place' },
      comparisonNotes: { [pair.id]: 'Unsubmitted comparison feedback' },
    });
    expect((await inspect(page)).navigation).toEqual(before.navigation);
  }
  const toggle = page.getByRole('button', { name: 'More', exact: true });
  expect(before.navigation).toMatchObject({
    id: 'navigation-toggle', role: 'button', available: true, expanded: false,
    controls: ['chrome-mockups', 'browse', 'rankings', 'export-json', 'home'],
  });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const navigation = await openNavigation(page);
  const opened = (await inspect(page)).navigation;
  expect(opened.revision).toBe(before.navigation.revision + 1);
  expect(await page.evaluate(() => (window as LiveWindow).tournament.setNavigation({ open: false })))
    .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' }, navigation: opened });
  expect(await page.evaluate(expectedRevision => (window as LiveWindow).tournament.setNavigation({ expectedRevision, open: false }), before.navigation.revision))
    .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' }, navigation: opened });
  expect(await page.evaluate(expectedRevision => (window as LiveWindow).tournament.setNavigation({ expectedRevision, open: true }), opened.revision))
    .toEqual({ ok: true, navigation: opened });
  const raced = await page.evaluate(expectedRevision => {
    document.getElementById('navigation-toggle')!.click();
    return (window as LiveWindow).tournament.setNavigation({ expectedRevision, open: true });
  }, opened.revision);
  expect(raced).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' }, navigation: { expanded: false, revision: opened.revision + 1 } });
  expect(await page.evaluate(expectedRevision => (window as LiveWindow).tournament.setNavigation({ expectedRevision, open: true }), raced.navigation.revision))
    .toMatchObject({ ok: true, navigation: { expanded: true, revision: raced.navigation.revision + 1 } });
  await expect(navigation).toBeVisible();
  const mockups = navigation.getByRole('link', { name: 'Chrome mockups' });
  const browse = navigation.getByRole('button', { name: 'All candidates' });
  for (const control of [toggle, mockups, browse]) {
    await control.focus();
    for (const key of ['ArrowLeft', 'ArrowRight', 's', 'l', 'h']) {
      await page.keyboard.press(key);
      await expect(control).toBeFocused();
      expect(await inspect(page)).toMatchObject({ state: before.state, busy: false, shortcutsAvailable: false });
    }
  }
  await toggle.focus();
  await page.keyboard.press('Tab');
  await expect(mockups).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(browse).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(mockups).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(navigation).toBeHidden();
  expect((await inspect(page)).navigation.expanded).toBe(false);
  await openNavigation(page);
  await page.locator('.title h1').click();
  await expect(navigation).toBeHidden();
  await openNavigation(page);
  await page.frameLocator('#frame-left').locator('body').click({ position: { x: 8, y: 8 } });
  await expect(navigation).toBeHidden();
  expect((await inspect(page)).focusedFrame).toBe('frame-left');
  expect(await retained.evaluate(({ frames, notes }) => ({
    frames: frames.every(({ side, node, doc, win }) =>
      document.getElementById(`frame-${side}`) === node && node.contentDocument === doc &&
      node.contentWindow === win && doc.body.dataset.folioScratch === side),
    notes: notes.every(node => document.getElementById(node.id) === node),
  }))).toEqual({ frames: true, notes: true });
  await expect(leftNote).toHaveValue('Left draft stays in place');
  await expect(rightNote).toHaveValue('Right draft stays in place');
  await expect(page.locator('#pair-note')).toHaveValue('Unsubmitted comparison feedback');
  await retained.dispose();

  await select.focus();
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    await expect(select).toBeFocused();
    expect(await inspect(page)).toMatchObject({ state: before.state, busy: false });
  }
  await page.keyboard.press('Tab');
  await expect(select).not.toBeFocused();
  await expect(page.locator('#pair-note')).not.toBeFocused();
  await (await openNavigation(page)).getByRole('button', { name: 'All candidates' }).click();
  await expect(page.getByRole('heading', { name: '22 different approaches' })).toBeVisible();
  expect((await inspect(page)).navigation.expanded).toBe(false);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await ready(page);
  await (await openNavigation(page)).getByRole('button', { name: 'Rankings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ranking in progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep comparing' }).click();
  await ready(page);
  await (await openNavigation(page)).getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to comparison' }).click();
  await ready(page);
  await unchanged(page, before.state);
});

test('appearance revision guards and waits work across tabs without changing the rehearsal', async ({ page, context }) => {
  const before = await openRehearsal(page);
  const other = await context.newPage();
  await other.goto(`/?rehearsal=1&session=${before.state.id}`);
  await ready(other);
  const initial = await appearance(page);
  const pending = await page.evaluateHandle(afterRevision => ({
    result: (window as LiveWindow).tournament.appearance.wait({ afterRevision, timeoutMs: 10000 }),
  }), initial.state.revision);
  const rejected = await page.evaluate(expectedRevision => {
    const api = (window as LiveWindow).tournament.appearance;
    return [api.act({ expectedRevision, mode: 'sepia' }), api.act({ mode: 'dark' })];
  }, initial.state.revision);
  for (const result of rejected) {
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' }, state: initial.state });
  }
  expect(await page.evaluate(afterRevision => (window as LiveWindow).tournament.appearance.wait({ afterRevision, timeoutMs: 0 }), initial.state.revision))
    .toMatchObject({ ok: true, changed: false, state: initial.state });

  const applied = await page.evaluate(expectedRevision => (window as LiveWindow).tournament.appearance.act({ expectedRevision, mode: 'dark' }), initial.state.revision);
  expect(applied).toMatchObject({ ok: true, state: { mode: 'dark', resolved: 'dark', revision: initial.state.revision + 1 } });
  expect(await pending.evaluate(async ({ result }) => result)).toMatchObject({ ok: true, changed: true, state: applied.state });
  await pending.dispose();
  expect(await page.evaluate(expectedRevision => (window as LiveWindow).tournament.appearance.act({ expectedRevision, mode: 'light' }), initial.state.revision))
    .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' }, state: applied.state });
  await expect(other.locator('#appearance-mode')).toHaveValue('dark');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');

  const synchronized = await page.evaluateHandle(afterRevision => ({
    result: (window as LiveWindow).tournament.appearance.wait({ afterRevision, timeoutMs: 10000 }),
  }), applied.state.revision);
  await other.locator('#appearance-mode').selectOption('light');
  expect(await synchronized.evaluate(async ({ result }) => result)).toMatchObject({
    ok: true, changed: true,
    state: { mode: 'light', resolved: 'light', revision: applied.state.revision + 1, persistence: 'saved' },
  });
  await synchronized.dispose();
  await expect(page.locator('#appearance-mode')).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await inspect(page)).appearance).toEqual((await appearance(page)).state);
  await unchanged(page, before.state);
  await unchanged(other, before.state);
  await other.close();
});

test('blocked storage reports a visible structured error but still applies appearance locally', async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage blocked for this test', 'SecurityError'); },
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  const before = await openRehearsal(page);
  expect((await appearance(page)).state).toMatchObject({
    mode: 'system', resolved: 'light', persistence: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' },
  });
  for (const mode of ['dark', 'light'] as const) {
    await page.locator('#appearance-mode').selectOption(mode);
    const result = await appearance(page);
    expect(result).toMatchObject({ ok: true, state: { mode, resolved: mode, persistence: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await expect(page.locator('#appearance-status')).toBeVisible();
    await expect(page.locator('#appearance-status')).toHaveText(result.state.error!.message);
  }
  const current = await appearance(page);
  expect(await page.evaluate(expectedRevision => (window as LiveWindow).tournament.appearance.act({ expectedRevision, mode: 'dark' }), current.state.revision))
    .toMatchObject({ ok: true, state: { mode: 'dark', resolved: 'dark', revision: current.state.revision + 1, persistence: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await unchanged(page, before.state);
});

test('card choices and all feedback outcomes save real notes and undo without losing them', async ({ page }) => {
  let live = await openRehearsal(page);
  const navigation = live.navigation;
  await page.locator('#appearance-mode').selectOption('dark');
  const { left, right } = live.state.pair!;
  await page.locator(`textarea[data-note="${left}"]`).fill('Saved candidate note');
  await page.locator('#save-notes').click();
  live = await changedComparison(page, live.state.revision + 1, 0);
  expect((await savedState(page, live.state.id)).notes[left]).toBe('Saved candidate note');
  expect(live.navigation).toEqual(navigation);
  expect(live.dirtyNotes).toEqual({});

  for (const response of ['left', 'right', 'skip', 'like-both', 'hate-both'] as const) {
    for (const side of ['left', 'right']) {
      await expect(page.locator(`.candidate[data-side="${side}"] #choose-${side}.vote`)).toBeEnabled();
    }
    const pair = live.state.pair!;
    const note = `Feedback for ${response}`;
    const draft = `Candidate note with ${response}`;
    await page.locator(`textarea[data-note="${right}"]`).fill(draft);
    await page.locator('#pair-note').fill(note);
    const winner = response === 'left' || response === 'right' ? pair[response] : null;
    const button = response === 'left' || response === 'right'
      ? page.locator(`.candidate[data-side="${response}"] #choose-${response}`)
      : page.locator(`#${response}`);
    await button.click();
    live = await changedComparison(page, live.state.revision + 1, 1);
    const stored = await savedState(page, live.state.id);
    expect(stored.comparisons).toHaveLength(1);
    expect(stored.comparisons[0]).toMatchObject({
      left: pair.left, right: pair.right, outcome: winner ? 'winner' : response, winner,
      loser: winner === null ? null : winner === pair.left ? pair.right : pair.left, note,
    });
    expect(stored.notes).toMatchObject({ [left]: 'Saved candidate note', [right]: draft });
    expect(live.dirtyNotes).toEqual({});

    await page.locator('#undo').click();
    live = await changedComparison(page, live.state.revision + 1, 0);
    expect(live.state.pair).toMatchObject({ left, right });
    expect((await savedState(page, live.state.id)).comparisons).toEqual([]);
    await expect(page.locator(`textarea[data-note="${left}"]`)).toHaveValue('Saved candidate note');
    await expect(page.locator(`textarea[data-note="${right}"]`)).toHaveValue(draft);
    await expect(page.locator('#pair-note')).toHaveValue(note);
    await expect(page.locator('#appearance-mode')).toHaveValue('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(live.navigation).toEqual(navigation);
  }
});
