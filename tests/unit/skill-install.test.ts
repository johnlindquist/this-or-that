import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function install(destination: string) {
  const process = Bun.spawn(['bun', 'scripts/install-skill.ts', '--dest', destination], { stdout:'pipe', stderr:'pipe' });
  const [stdout,stderr,exitCode]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);
  return {stdout,stderr,exitCode};
}

test('skill installation is complete and identical reinstall is harmless',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tot-skill-'));
  try {
    const destination=join(root,'this-or-that');
    const first=await install(destination);
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({status:'installed'});
    for (const file of ['SKILL.md','references/interactive-contract.md','references/sprint-demo.md','references/evidence-and-selection.md','references/reconstruction-prompts.md']) {
      expect(await readFile(join(destination,file),'utf8')).toBe(await readFile(join('skills','this-or-that',file),'utf8'));
    }
    const second=await install(destination);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({status:'already-installed'});
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('skill installation refuses to replace unrelated content',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tot-skill-'));
  try {
    const destination=join(root,'this-or-that');
    await mkdir(destination);
    await writeFile(join(destination,'SKILL.md'),'User-owned skill. Do not replace.');
    const result=await install(destination);
    expect(result.exitCode).not.toBe(0);
    expect(await readFile(join(destination,'SKILL.md'),'utf8')).toBe('User-owned skill. Do not replace.');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('skill installation refuses existing empty directories and symlink destinations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tot-skill-'));
  try {
    const empty=join(root,'empty');await mkdir(empty);
    const emptyResult=await install(empty);
    expect(emptyResult.exitCode).not.toBe(0);
    expect(JSON.parse(emptyResult.stdout)).toMatchObject({ok:false,error:{code:'destination-occupied',message:expect.stringContaining('nonexistent')}});
    expect(await readdir(empty)).toEqual([]);
    const link=join(root,'linked');await symlink(empty,link);
    expect((await install(link)).exitCode).not.toBe(0);
    expect(await readdir(empty)).toEqual([]);
  } finally { await rm(root,{recursive:true,force:true}); }
});
