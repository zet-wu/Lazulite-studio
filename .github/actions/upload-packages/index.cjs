const fs = require('node:fs');
const path = require('node:path');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

(async () => {
  const {DefaultArtifactClient} = await import('@actions/artifact');
  const packagingDir = path.resolve(__dirname, '../../../packaging');
  const models = JSON.parse(fs.readFileSync(path.join(packagingDir, 'models.json'), 'utf8'));
  const runtime = JSON.parse(fs.readFileSync(path.join(packagingDir, 'runtime-manifest.json'), 'utf8'));
  const targets = Object.keys(runtime.targets).map(escapeRegExp).join('|');
  const modelZips = Object.values(models)
    .filter(spec => spec && typeof spec === 'object' && spec.directory)
    .map(spec => escapeRegExp(`${spec.directory}.zip`))
    .join('|');
  const allowedPattern = new RegExp(`^(?:LazuliteStudio-(?:${targets})\\.7z(?:\\.\\d{3,})?|${modelZips})$`);
  const root = path.resolve(process.env.INPUT_PATH);
  const files = fs.readdirSync(root).sort();
  if (!files.length || files.some(name => !allowedPattern.test(name))) {
    throw new Error('Expected portable 7z archives/volumes or alignment or vocal model ZIPs');
  }
  const client = new DefaultArtifactClient();
  for (const name of files) {
    const result = await client.uploadArtifact(name, [path.join(root, name)], root,
      {skipArchive: true, retentionDays: 14});
    console.log(`Uploaded ${name}: ${result.id} (${result.size} bytes)`);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
