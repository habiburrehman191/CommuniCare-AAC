import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const base = path.resolve('node_modules/.cache/aac-tests');
await mkdir(base, { recursive: true });
const outdir = await mkdtemp(path.join(base, 'run-'));
try {
  await build({ entryPoints: ['tests/communication/core.test.ts', 'tests/communication/store.test.ts', 'tests/communication/voice.test.ts', 'tests/communication/speech.test.ts', 'tests/communication/ui.test.ts', 'tests/communication/persistence.test.ts', 'tests/communication/integration.test.ts', 'tests/communication/signature.test.ts', 'tests/communication/transcribe.test.ts', 'tests/communication/tts.test.ts', 'tests/communication/camera.test.ts', 'tests/communication/signRecognition.test.ts', 'tests/communication/controlledSignRecognition.test.ts', 'tests/communication/communicareSignV1Integration.test.ts', 'tests/communication/signCollectionAndNormalization.test.ts', 'tests/communication/realtimeSignRecognition.test.ts'], outdir, bundle: true, platform: 'node', format: 'esm', packages: 'external', outExtension: {'.js':'.mjs'}, tsconfig:'tsconfig.app.json' });
  const result = spawnSync(process.execPath, ['--test', path.join(outdir,'core.test.mjs'), path.join(outdir,'store.test.mjs'), path.join(outdir,'voice.test.mjs'), path.join(outdir,'speech.test.mjs'), path.join(outdir,'ui.test.mjs'), path.join(outdir,'persistence.test.mjs'), path.join(outdir,'integration.test.mjs'), path.join(outdir,'signature.test.mjs'), path.join(outdir,'transcribe.test.mjs'), path.join(outdir,'tts.test.mjs'), path.join(outdir,'camera.test.mjs'), path.join(outdir,'signRecognition.test.mjs'), path.join(outdir,'controlledSignRecognition.test.mjs'), path.join(outdir,'communicareSignV1Integration.test.mjs'), path.join(outdir,'signCollectionAndNormalization.test.mjs'), path.join(outdir,'realtimeSignRecognition.test.mjs'), path.resolve('tests/offline/sw.test.mjs')], {stdio:'inherit'});
  process.exitCode = result.status ?? 1;
} finally {
  if (path.dirname(outdir) !== base) throw new Error('Unexpected test output path');
  await rm(outdir, {recursive:true,force:true});
}
