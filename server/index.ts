import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Server } from 'bun';
import { createApp } from './app';
import { DomainError, LIMITS } from '../shared/contract';
import { digest } from '../shared/canonical';

const root = resolve(import.meta.dir, '..');

async function fingerprint(): Promise<string> {
  const sources: Record<string, string> = { bun: Bun.version };
  const collect = async (directory: string): Promise<void> => {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Source directory must not be a symlink: ${directory}`);
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Source symlink is not supported: ${path}`);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile() && /\.(ts|css|html)$/.test(entry.name)) sources[relative(root, path)] = await readFile(path, 'utf8');
    }
  };
  await Promise.all(['shared', 'server', 'web'].map(directory => collect(join(root, directory))));
  sources['.build/app.js'] = await readFile(join(root, '.build', 'app.js'), 'utf8');
  return `sha256:${digest(sources)}`;
}

export async function start(): Promise<void> {
  const portText = process.env.PORT ?? '8477';
  if (!/^[1-9][0-9]*$/.test(portText) || Number(portText) > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const port = Number(portText);
  if (process.env.TOT_TEST_MODE !== undefined && process.env.TOT_TEST_MODE !== '0' && process.env.TOT_TEST_MODE !== '1') throw new Error('TOT_TEST_MODE must be 0 or 1.');
  const testMode = process.env.TOT_TEST_MODE === '1';
  if (testMode && !process.env.TOT_DATA_DIR) throw new Error('Test mode requires a separate explicit TOT_DATA_DIR; never reuse recording storage.');
  const dataRoot = resolve(root, process.env.TOT_DATA_DIR ?? '.data');
  const build = join(root, '.build');
  await mkdir(build, { recursive: true });
  const buildInfo = await lstat(build);
  if (buildInfo.isSymbolicLink() || !buildInfo.isDirectory()) throw new Error('.build must be a real directory, not a symlink.');
  try {
    const output = await lstat(join(build, 'app.js'));
    if (output.isSymbolicLink() || !output.isFile()) throw new Error('Refusing an unsafe .build/app.js destination.');
  } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  const result = await Bun.build({
    entrypoints: [join(root, 'web', 'main.ts')], outdir: build, naming: 'app.js',
    target: 'browser', format: 'esm', sourcemap: 'none', minify: false,
  });
  if (!result.success) {
    for (const message of result.logs) console.error(message);
    throw new Error('Browser bundle failed; server was not started.');
  }
  const app = await createApp({ dataRoot, buildId: await fingerprint(), port, testMode });
  let server: Server<undefined>;
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port, fetch: app.fetch, maxRequestBodySize: LIMITS.bodyBytes, idleTimeout: 15 });
  } catch (error) {
    await app.close();
    throw new Error(`Could not bind 127.0.0.1:${port}. If occupied, choose another PORT; do not stop unrelated processes.`, { cause: error });
  }
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // Keep the listening handle alive until async file/lock cleanup completes.
    // The closing repository rejects new mutations while pending writes drain.
    try { await app.close(); }
    finally { await server.stop(true); }
  };
  const onSignal = (): void => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  console.log(`This or that → http://127.0.0.1:${server.port}/`);
  console.log(testMode ? 'Automated test mode — recording sessions disabled.' : 'Local lesson — fresh sessions remain unselected.');
}

if (import.meta.main) {
  try { await start(); }
  catch (error) {
    console.error(error instanceof DomainError ? `${error.code}: ${error.message}` : error);
    process.exitCode = 1;
  }
}
