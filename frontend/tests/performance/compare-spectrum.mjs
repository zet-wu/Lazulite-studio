// Compare production algorithms without retaining an old implementation in the repo.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
const baselineRef = process.argv[2] ?? 'e2edea2';
const output = process.argv[3];
if (!output) throw new Error('Usage: node compare-spectrum.mjs BASELINE_REF OUTPUT_JSON');
const source = 'frontend/src/domain/spectrogram.ts';
const old = execFileSync('git', ['show', `${baselineRef}:${source}`], { encoding: 'utf8', cwd: '..' });
const current = readFileSync(`../${source}`, 'utf8');
const load = async text => import(`data:text/javascript;base64,${Buffer.from(transpileModule(text, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText).toString('base64')}`);
const pcm = Int16Array.from({ length: 4 * 48000 * 2 }, (_, i) => Math.round(Math.sin(Math.floor(i / 2) * Math.PI * 880 / 48000) * 12000));
const rows = [];
for (const [name, text] of [['baseline', old], ['current', current]]) {
  const algorithm = await load(text);
  for (let i = 0; i < 5; i++) algorithm.computeSpectrogram(pcm, 48000, 2);
  const times = [];
  for (let i = 0; i < 20; i++) { const start = performance.now(); algorithm.computeSpectrogram(pcm, 48000, 2); times.push(performance.now() - start); }
  const sorted = [...times].sort((a, b) => a - b);
  rows.push({ name, width: algorithm.SPECTRUM_WIDTH, height: algorithm.SPECTRUM_HEIGHT, times, p50: sorted[10], p95: sorted[19] });
}
writeFileSync(output, JSON.stringify({ baselineRef, node: process.version, input: { duration: 4, rate: 48000, channels: 2 }, warmup: 5, iterations: 20, scope: 'Node computation only; full UI comparison and platform scaling are separate', rows }, null, 2));
