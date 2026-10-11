const fs = require('node:fs');
const path = require('node:path');
const {DefaultArtifactClient} = require('@actions/artifact');

(async () => {
  const root = path.resolve(process.env.INPUT_PATH);
  const files = fs.readdirSync(root).sort();
  if (!files.length || files.some(name => !/\.7z(?:\.\d{3,})?$/.test(name))) {
    throw new Error('Expected only verified .7z archives or volumes');
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
