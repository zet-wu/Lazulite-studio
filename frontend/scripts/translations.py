"""Validate resources and exchange UTF-8 CSV without a second translation source."""
import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'src' / 'i18n'
REGISTRY = ROOT.parents[2] / 'server' / 'ui_languages.json'
PARAM = re.compile(r'{{\s*([\w]+)\s*}}')
VARIANT = re.compile(r'_(zero|one|two|few|many|other)$')


def read(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError(f'duplicate key: {key}')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)


def resources(root):
    languages=read(REGISTRY)
    seen=set()
    for item in languages:
        identity=item.get('id','')
        if not re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*',identity) or identity in seen:
            raise ValueError(f'invalid or duplicate language: {identity}')
        seen.add(identity)
        if not item.get('name') or item.get('direction') not in ('ltr','rtl') or not isinstance(item.get('complete'),bool):
            raise ValueError(f'{identity}: invalid language metadata')
        forms=item.get('plurals',[])
        if not forms or len(forms)!=len(set(forms)) or any(form not in ('zero','one','two','few','many','other') for form in forms):
            raise ValueError(f'{identity}: invalid plural forms')
    if 'zh-Hans' not in seen:raise ValueError('the source language is required')
    return languages,{item['id']:read(root/'resources'/f"{item['id']}.json") for item in languages}


def validate(root, replacements=None):
    languages, values=resources(root)
    if replacements: values.update(replacements)
    context=read(root/'context.json'); source=values['zh-Hans'];errors=[]
    for key,text in source.items():
        if key not in context:errors.append(f'{key}: missing context')
        elif context[key]['source']!=text:errors.append(f'{key}: source meaning changed; review translations and context')
    for language in languages:
        identity=language['id']; target=values[identity]
        for key,text in target.items():
            base=VARIANT.sub('',key)
            reference=source.get(key,source.get(base+'_other',source.get(base)))
            if reference is None:errors.append(f'{identity}/{key}: unknown key');continue
            if not isinstance(text,str) or not text.strip():errors.append(f'{identity}/{key}: empty translation');continue
            if set(PARAM.findall(text))!=set(PARAM.findall(reference)):errors.append(f'{identity}/{key}: parameters differ')
        if language['complete']:
            for key in source:
                base=VARIANT.sub('',key)
                required=[base+'_'+variant for variant in language['plurals']] if VARIANT.search(key) else [key]
                for required_key in required:
                    if required_key not in target:errors.append(f'{identity}/{required_key}: required translation missing')
    if errors:raise ValueError('\n'.join(dict.fromkeys(errors)))
    return languages,values,context


def table_keys(languages, values):
    keys=set().union(*(set(value) for value in values.values()))
    for key in values['zh-Hans']:
        if VARIANT.search(key):
            base=VARIANT.sub('',key)
            keys.update(base+'_'+variant for language in languages for variant in language['plurals'])
    return keys


def export_table(root,path):
    languages,values,context=validate(root)
    keys=sorted(table_keys(languages,values))
    with path.open('w',encoding='utf-8',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=['key','variant','context','parameters',*[lang['id'] for lang in languages]])
        writer.writeheader()
        for key in keys:
            base=VARIANT.sub('',key);meta=context.get(key,context.get(base+'_other',context.get(base,{})))
            writer.writerow({'key':key,'variant':VARIANT.search(key).group(1) if VARIANT.search(key) else '',
                'context':meta.get('context',''),'parameters':','.join(meta.get('params',[])),**{lang['id']:values[lang['id']].get(key,'') for lang in languages}})


def import_table(root,path,language):
    languages,values=resources(root)
    if language not in values:raise ValueError('register the target language first')
    target=dict(values[language]);known=table_keys(languages,values);seen=set()
    with path.open(encoding='utf-8-sig',newline='') as file:
        reader=csv.DictReader(file)
        if not reader.fieldnames or 'key' not in reader.fieldnames or language not in reader.fieldnames:raise ValueError('CSV columns missing')
        if len(reader.fieldnames)!=len(set(reader.fieldnames)):raise ValueError('duplicate CSV columns')
        for row in reader:
            key=row['key']
            if None in row or any(value is None for value in row.values()):raise ValueError('damaged CSV row')
            if key in seen:raise ValueError(f'duplicate key: {key}')
            if key not in known:raise ValueError(f'unknown key: {key}')
            seen.add(key)
            text=row[language]
            if not text and key not in target:continue # Other languages may have additional plural forms.
            target[key]=text
    validate(root,{language:target})
    destination=root/'resources'/f'{language}.json'
    temporary=destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(target,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temporary.replace(destination)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['check','export','import']);parser.add_argument('file',nargs='?',type=Path)
    parser.add_argument('--language');parser.add_argument('--root',type=Path,default=ROOT)
    args=parser.parse_args()
    try:
        if args.action=='check':validate(args.root)
        elif args.action=='export':
            if not args.file:parser.error('export requires a CSV file')
            export_table(args.root,args.file)
        else:
            if not args.file or not args.language:parser.error('import requires a CSV file and --language')
            import_table(args.root,args.file,args.language)
    except (ValueError,OSError) as error:parser.exit(1,str(error)+'\n')

if __name__=='__main__':main()
