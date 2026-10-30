"""Generate bounded shape resources from the pinned native OpenCC wheel.

Run: python -m server.generate_shapes. Runtime never rebuilds these tables.
"""
import importlib.metadata
import json
from pathlib import Path
import subprocess
import shutil
import tempfile

VERSION = '1.4.2'
ROOT = Path(__file__).parent / 'vendor/opencc-shapes'


def generate():
    import opencc
    if importlib.metadata.version('OpenCC') != VERSION:
        raise ValueError('OpenCC 1.4.2 required')
    native = Path(opencc.__file__).parent / 'clib'
    share = native / 'share/opencc'
    compiler = native / 'bin' / ('opencc_dict.exe' if __import__('os').name == 'nt' else 'opencc_dict')
    ROOT.mkdir(exist_ok=True)
    package = importlib.metadata.distribution('OpenCC')
    for file in package.files:
        if Path(file).name in ('LICENSE', 'AUTHORS'):
            shutil.copy2(package.locate_file(file), ROOT / Path(file).name)
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        def read(name):
            path = temp / (name + '.txt')
            subprocess.run([str(compiler), '-i', str(share / (name+'.ocd2')), '-o', str(path), '-f', 'ocd2', '-t', 'text'], check=True, capture_output=True)
            return {s: t.split(' ') for line in path.read_text(encoding='utf-8').splitlines() if line and not line.startswith('#') for s,t in [line.split('\t')]}
        names = ['STPhrases', 'STCharacters', 'JPShinjitaiPhrases', 'JPShinjitaiCharacters', 'TWVariantsRevPhrases', 'TWVariantsRev', 'HKVariantsRevPhrases', 'HKVariantsRev']
        tables = {name: read(name) for name in names}
        chars = tables['JPShinjitaiCharacters']
        original = tables['JPShinjitaiPhrases']
        filtered = {s: [t for t in values if len(s)==len(t) and all(a==b or b in chars.get(a,[]) for a,b in zip(s,t))] for s,values in original.items()}
        tables['JPShinjitaiPhrases'] = {s: ts for s,ts in filtered.items() if ts}
        report = [{'source':s,'before':ts,'after':filtered[s]} for s,ts in original.items() if ts!=filtered[s]]
        # Sources are merged by exact dictionary key, not by whole-line conversion
        # or guessed language. Competing defaults are explicitly unresolved.
        merged, defaults = {}, {}
        for table in tables.values():
            for source, values in table.items():
                if any(len(source)!=len(t) for t in values):
                    raise ValueError(f'Unequal mapping: {source}')
                defaults.setdefault(source,set()).add(values[0])
                targets = merged.setdefault(source,[])
                for value in values:
                    if value not in targets: targets.append(value)
        conflicts = sorted(s for s,values in defaults.items() if len(values)>1)
        def compile_table(name, table):
            path = temp / (name+'.txt')
            path.write_text(''.join(s+'\t'+' '.join(ts)+'\n' for s,ts in sorted(table.items())),encoding='utf-8')
            subprocess.run([str(compiler),'-i',str(path),'-o',str(ROOT/(name+'.ocd2')),'-f','text','-t','ocd2'],check=True,capture_output=True)
        compile_table('MixedShapes',merged)
        # Only shape tables; regional vocabulary tables are deliberately excluded.
        targets = {'simplified':['TSPhrases','TSCharacters'], 'taiwan':['TWVariantsPhrases','TWVariants'], 'hongkong':['HKVariantsPhrases','HKVariants'], 'japanese':['JPShinjitaiCharactersRev']}
        for name in {n for values in targets.values() for n in values}:
            table=read(name)
            if any(len(s)!=len(t) for s,values in table.items() for t in values): raise ValueError(name)
            compile_table(name,table)
        (ROOT/'manifest.json').write_text(json.dumps({'version':VERSION,'conflicts':conflicts,'targets':targets},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        (ROOT/'japanese-filter.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'entries':len(merged),'conflicts':len(conflicts),'japaneseChanges':len(report)}))


if __name__ == '__main__': generate()
