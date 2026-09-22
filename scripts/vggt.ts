import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { parseColmapRequest, readLocalPoseResult } from '../src/pose/colmap';

async function main() {
  const [input, output, ...options] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: pnpm vggt request.zip result.json [--device cpu|cuda] [--checkpoint model.pt]');
  const archive = await JSZip.loadAsync(await readFile(input));
  const manifest = archive.file('request.json');
  if (!manifest) throw new Error('Missing request.json. Export reference photos from a subject card.');
  const request = parseColmapRequest(JSON.parse(await manifest.async('string')));
  const outputPath = resolve(output);
  try { await access(outputPath); throw new Error(`Output already exists: ${outputPath}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(dirname(outputPath), {recursive:true});
  const directory = await mkdtemp(join(tmpdir(), 'parallax-vggt-result-'));
  try {
    const resultPath = join(directory,'result.json');
    const python = process.env.VGGT_PYTHON || (existsSync('temp/vggt-venv/bin/python') ? 'temp/vggt-venv/bin/python' : 'python3');
    await new Promise<void>((resolveRun,reject) => {
      const child = spawn(python,['scripts/vggt_inference.py',input,resultPath,...options],{
        stdio:'inherit', env:{...process.env, HF_HOME:process.env.HF_HOME || resolve('temp/vggt-cache')},
      });
      const interrupt = () => child.kill('SIGINT');
      process.on('SIGINT',interrupt);
      child.on('error',error => reject(new Error(`Cannot run ${python}: ${error.message}. Set VGGT_PYTHON to the installed environment.`)));
      child.on('close',code => { process.removeListener('SIGINT',interrupt); if (code === 0) resolveRun(); else reject(new Error(`VGGT exited with ${code}. No app data was changed.`)); });
    });
    const result = JSON.parse(await readFile(resultPath,'utf8'));
    readLocalPoseResult(result,request.subjectId,request.images.map(image => image.id),'vggt');
    await writeFile(outputPath,JSON.stringify(result,null,2),{flag:'wx'});
    console.log(`Import ${output} using VGGT (local) on the subject card.`);
  } finally { await rm(directory,{recursive:true,force:true}); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
