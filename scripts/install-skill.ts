import { lstat, mkdir, open, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const name = 'this-or-that';
const source = resolve(import.meta.dir, '../skills', name);
const packageFiles = [
  'SKILL.md',
  'references/interactive-contract.md',
  'references/sprint-demo.md',
  'references/evidence-and-selection.md',
  'references/reconstruction-prompts.md',
] as const;
let destination = join(homedir(), '.agents', 'skills', name);

class InstallError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
function emit(value: object): void { console.log(JSON.stringify(value)); }

async function inventory(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(`${relative}/`);
      if (relative === 'references') paths.push(...await inventory(root, relative));
    } else if (entry.isFile()) {
      paths.push(relative);
    } else {
      throw new InstallError('unsafe-entry', `Refusing a symbolic link or special file: ${join(root, relative)}`);
    }
  }
  return paths.sort();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    emit({ ok: true, status: 'help', name, usage: 'bun run skill:install [--dest <directory>]', defaultDestination: destination, overwrite: 'never; identical packages are accepted' });
    return;
  }
  if (args.length !== 0) {
    if (args.length !== 2 || args[0] !== '--dest' || !args[1] || args[1].startsWith('--')) {
      throw new InstallError('invalid-arguments', 'Use --dest <directory>, or omit arguments for ~/.agents/skills/this-or-that.');
    }
    const requested = args[1] === '~' ? homedir() : args[1].startsWith('~/') ? join(homedir(), args[1].slice(2)) : args[1];
    destination = resolve(requested);
  }

  const expectedEntries = [...packageFiles, 'references/'].sort();
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new InstallError('invalid-source', 'The skill source must be a real directory.');
  }
  if (JSON.stringify(await inventory(source)) !== JSON.stringify(expectedEntries)) {
    throw new InstallError('invalid-source', 'The source package must contain exactly SKILL.md and its four bundled references.');
  }
  const contents = await Promise.all(packageFiles.map(path => readFile(join(source, path))));
  if (!/^---\r?\nname: this-or-that\r?\n/.test(contents[0]!.toString('utf8'))) {
    throw new InstallError('invalid-source', 'SKILL.md does not identify the this-or-that skill.');
  }

  async function existingStatus(): Promise<'absent' | 'identical' | 'different'> {
    try {
      const stat = await lstat(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return 'different';
      if (JSON.stringify(await inventory(destination)) !== JSON.stringify(expectedEntries)) return 'different';
      for (let index = 0; index < packageFiles.length; index++) {
        if (!(await readFile(join(destination, packageFiles[index]!))).equals(contents[index]!)) return 'different';
      }
      return 'identical';
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        try { await lstat(destination); } catch (missing) { if (isCode(missing, 'ENOENT')) return 'absent'; throw missing; }
        return 'different';
      }
      if (error instanceof InstallError && error.code === 'unsafe-entry') return 'different';
      throw error;
    }
  }
  function success(status: 'installed' | 'already-installed'): void {
    emit({ ok: true, status, name, source, destination, files: [...packageFiles] });
  }
  function occupied(): never {
    throw new InstallError('destination-occupied', 'Destination is not an identical package. Nothing was overwritten. Choose a nonexistent --dest directory or review the existing installation manually.');
  }

  const initial = await existingStatus();
  if (initial === 'identical') { success('already-installed'); return; }
  if (initial === 'different') occupied();
  await mkdir(dirname(destination), { recursive: true });
  // Recheck immediately before claiming the directory; mkdir itself is exclusive.
  const current = await existingStatus();
  if (current === 'identical') { success('already-installed'); return; }
  if (current === 'different') occupied();
  try {
    await mkdir(destination);
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error;
    if (await existingStatus() === 'identical') { success('already-installed'); return; }
    occupied();
  }

  const createdFiles: string[] = [];
  let referencesCreated = false;
  try {
    await mkdir(join(destination, 'references'));
    referencesCreated = true;
    for (let index = 0; index < packageFiles.length; index++) {
      const target = join(destination, packageFiles[index]!);
      const handle = await open(target, 'wx', 0o644);
      createdFiles.push(target);
      try { await handle.writeFile(contents[index]!); await handle.sync(); }
      finally { await handle.close(); }
    }
  } catch (error) {
    // Only remove entries created by this attempt, never an existing package.
    const cleanupFailures: string[] = [];
    for (const file of createdFiles.reverse()) {
      try { await unlink(file); } catch { cleanupFailures.push(file); }
    }
    if (referencesCreated) {
      try { await rmdir(join(destination, 'references')); } catch { cleanupFailures.push(join(destination, 'references')); }
    }
    try { await rmdir(destination); } catch { cleanupFailures.push(destination); }
    throw new InstallError('install-failed', `${error instanceof Error ? error.message : String(error)}${cleanupFailures.length ? `; partial entries preserved for review: ${cleanupFailures.join(', ')}` : '; new package removed'}`);
  }
  success('installed');
}

try {
  await main();
} catch (error) {
  emit({ ok: false, status: 'error', name, source, destination, error: { code: error instanceof InstallError ? error.code : 'filesystem-error', message: error instanceof Error ? error.message : String(error) } });
  process.exitCode = 1;
}
