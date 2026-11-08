"""Build the two platform-independent alignment model ZIP assets."""
import argparse
import json
from pathlib import Path
import tempfile
import zipfile

from archive import download

ROOT = Path(__file__).resolve().parent


def build(output, cache):
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / 'models.json').read_text(encoding='utf-8'))
    results = []
    for family in ('nextfire', 'mms_fa'):
        spec = manifest[family]
        name = spec['directory']
        archive = output / (name + '.zip')
        partial = archive.with_suffix('.zip.partial')
        try:
            with tempfile.TemporaryDirectory(dir=cache) as work:
                model = Path(work) / name
                model.mkdir()
                for item in spec['files']:
                    source = download(item.get('url', spec['source']), cache / name / item['name'], item['sha256'], item['size'])
                    # ZIP reads directly from cache: no second copy of the large weights.
                    if item['name'] == 'model.pt':
                        (model / 'alignment-model.json').write_text('{"type":"torchaudio-mms-fa","weights":"model.pt"}\n', encoding='utf-8')
                (model / 'SOURCE.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                (model / 'NOTICE.txt').write_text(
                    f"Source: {spec['source']}\nLicense: {spec['license']}\n{spec['license_url']}\n"
                    'Original model weights and configuration are redistributed unchanged.\n', encoding='utf-8')
                with zipfile.ZipFile(partial, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
                    for item in spec['files']:
                        target.write(cache / name / item['name'], name + '/' + item['name'])
                    for path in model.iterdir():
                        target.write(path, name + '/' + path.name)
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
        results.append({'file': archive.name, 'size': archive.stat().st_size})
    print(json.dumps(results, indent=2))
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    build(args.output.resolve(), args.cache.resolve())
