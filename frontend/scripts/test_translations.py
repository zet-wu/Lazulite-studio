import csv
import importlib.util
import json
import shutil
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('translations',Path(__file__).with_name('translations.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def test_roundtrip_changes_only_target_and_rejects_duplicate_keys_and_parameters(tmp_path):
    root=tmp_path/'i18n';shutil.copytree(module.ROOT,root)
    table=tmp_path/'translations.csv';module.export_table(root,table)
    original={p.name:p.read_bytes() for p in (root/'resources').glob('*.json')}
    module.import_table(root,table,'en')
    assert {p.name:p.read_bytes() for p in (root/'resources').glob('*.json')}==original
    with table.open(newline='') as file:reader=csv.DictReader(file);fields=reader.fieldnames;rows=list(reader)
    rows[0]['en']='Changed translation'
    with table.open('w',newline='') as file:writer=csv.DictWriter(file,fieldnames=fields);writer.writeheader();writer.writerows(rows)
    module.import_table(root,table,'en')
    assert (root/'resources/zh-Hans.json').read_bytes()==original['zh-Hans.json']
    with table.open('a',newline='') as file:csv.DictWriter(file,fieldnames=fields).writerow(rows[0])
    with pytest.raises(ValueError,match='duplicate'):module.import_table(root,table,'en')
    values=json.loads((root/'resources/en.json').read_text());values['menu.save']='{{unexpected}}'
    with pytest.raises(ValueError,match='parameters'):module.validate(root,{'en':values})


def test_source_changes_require_review_and_missing_rows_do_not_delete_resources(tmp_path):
    root=tmp_path/'i18n';shutil.copytree(module.ROOT,root)
    table=tmp_path/'partial.csv';table.write_text('key,en\nmenu.save,Save\n')
    before=(root/'resources/en.json').read_bytes();module.import_table(root,table,'en')
    assert (root/'resources/en.json').read_bytes()==before
    values=json.loads((root/'resources/zh-Hans.json').read_text());values['menu.save']='保存到文件'
    (root/'resources/zh-Hans.json').write_text(json.dumps(values))
    with pytest.raises(ValueError,match='meaning changed'):module.validate(root)


def test_registered_language_plural_forms_and_incomplete_resources(tmp_path, monkeypatch):
    root=tmp_path/'i18n';shutil.copytree(module.ROOT,root)
    registry=tmp_path/'languages.json';languages=module.read(module.REGISTRY)
    languages.append({'id':'fr','name':'Français','html':'fr','format':'fr','direction':'ltr','plurals':['one','other'],'complete':False})
    registry.write_text(json.dumps(languages));monkeypatch.setattr(module,'REGISTRY',registry)
    (root/'resources/fr.json').write_text('{}')
    module.validate(root)
    languages[-1]['complete']=True;registry.write_text(json.dumps(languages))
    with pytest.raises(ValueError,match='required translation'):module.validate(root)
    languages[-1]['complete']=False;registry.write_text(json.dumps(languages))
    english=module.read(root/'resources/en.json');english.pop('editor.itemCount_one')
    with pytest.raises(ValueError,match='itemCount_one'):module.validate(root,{'en':english})
