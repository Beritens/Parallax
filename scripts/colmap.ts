import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { convertColmap, parseColmapRequest } from '../src/pose/colmap';

async function main() {
  const [input, output, ...options] = process.argv.slice(2);
  const enhanced = options.includes('--enhanced');
  const fixedFocal = options.includes('--fixed-focal');
  if (options.some(option => !['--enhanced', '--fixed-focal'].includes(option))) throw new Error('Supported options: --enhanced --fixed-focal');
  if (!input || !output) throw new Error('Usage: pnpm colmap request.zip result.json [--enhanced] [--fixed-focal]');
  // Prepare the destination before expensive reconstruction, including new folders.
  const outputPath = resolve(output);
  await mkdir(dirname(outputPath), { recursive: true });
  const executable = process.env.COLMAP_BIN || 'colmap';
  const run = (command: string, args: string[], capture = false) => {
    const result = spawnSync(executable, [command, ...args], { stdio: capture ? 'pipe' : 'inherit', encoding:'utf8', env: { ...process.env, QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM || 'offscreen' } });
    if (result.error) throw new Error(`Cannot run ${executable}: ${result.error.message}. Install COLMAP or set COLMAP_BIN.`);
    if (result.status !== 0) throw new Error(`COLMAP ${command} failed (${result.status}). ${result.stderr || ''}`);
    return (result.stdout || '') + (result.stderr || '');
  };
  const extractionHelp = run('feature_extractor', ['-h'], true);
  const matchingHelp = run('exhaustive_matcher', ['-h'], true);
  const zip = await JSZip.loadAsync(await readFile(input));
  const manifest = zip.file('request.json');
  if (!manifest) throw new Error('Missing request.json. Export a COLMAP request from the subject card.');
  const request = parseColmapRequest(JSON.parse(await manifest.async('string')));
  const workspace = await mkdtemp(join(tmpdir(), 'parallax-colmap-'));
  console.log(`Workspace (retained for inspection): ${workspace}`);
  const images = join(workspace,'images'), sparse = join(workspace,'sparse'), database = join(workspace,'database.db');
  await mkdir(images); await mkdir(sparse);
  for (const image of request.images) {
    const file = zip.file(`images/${image.name}`);
    if (!file) throw new Error(`Missing ${image.name}`);
    await writeFile(join(images,image.name), await file.async('nodebuffer'));
  }
  // Enhanced mode constrains square pixels; fixed mode retains the requested FOV.
  const focalFactor = 1/(2*Math.tan(request.horizontalFov*Math.PI/360));
  run('feature_extractor', ['--database_path',database,'--image_path',images,'--ImageReader.camera_model',enhanced ? 'SIMPLE_PINHOLE' : 'PINHOLE',
    '--ImageReader.single_camera_per_image','1','--ImageReader.default_focal_length_factor',String(focalFactor),
    extractionHelp.includes('FeatureExtraction.use_gpu') ? '--FeatureExtraction.use_gpu' : '--SiftExtraction.use_gpu','0',
    ...(enhanced ? ['--SiftExtraction.estimate_affine_shape','1','--SiftExtraction.domain_size_pooling','1','--SiftExtraction.peak_threshold','0.002',
      extractionHelp.includes('FeatureExtraction.num_threads') ? '--FeatureExtraction.num_threads' : '--SiftExtraction.num_threads','4'] : [])]);
  run('exhaustive_matcher', ['--database_path',database,
    matchingHelp.includes('FeatureMatching.use_gpu') ? '--FeatureMatching.use_gpu' : '--SiftMatching.use_gpu','0',
    ...(enhanced ? [matchingHelp.includes('FeatureMatching.guided_matching') ? '--FeatureMatching.guided_matching' : '--SiftMatching.guided_matching','1'] : [])]);
  run('mapper', ['--database_path',database,'--image_path',images,'--output_path',sparse,
    ...(fixedFocal ? ['--Mapper.ba_refine_focal_length','0'] : [])]);
  let best: ReturnType<typeof convertColmap> | undefined;
  for (const model of await readdir(sparse, {withFileTypes:true})) {
    if (!model.isDirectory()) continue;
    const directory = join(sparse,model.name), textDirectory = join(workspace,`text-${model.name}`);
    await mkdir(textDirectory);
    run('model_converter', ['--input_path',directory,'--output_path',textDirectory,'--output_type','TXT']);
    try {
      const texts = await Promise.all(['cameras.txt','images.txt','points3D.txt'].map(name => readFile(join(textDirectory,name),'utf8')));
      const result = convertColmap(request,texts[0],texts[1],texts[2]);
      if (!best || Object.keys(result.cameras).length > Object.keys(best.cameras).length || (Object.keys(result.cameras).length === Object.keys(best.cameras).length && result.pointCount > best.pointCount)) best = result;
    } catch (error) { console.warn(`Skipping model ${model.name}: ${error instanceof Error ? error.message : error}`); }
  }
  if (!best) throw new Error('No usable reconstruction. Try more overlapping photos from different positions.');
  await writeFile(outputPath, JSON.stringify({version:1,subjectId:request.subjectId,reconstruction:best},null,2), {flag:'wx'});
  console.log(`Registered ${Object.keys(best.cameras).length}/${request.images.length} cameras. Import ${output} on the subject card.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
