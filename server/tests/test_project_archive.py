import io
import json
import zipfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from server.app import create_app
from server.auth import Settings
from server.db import Database
from server.revisions import RevisionStore
from server.project_document import initial_project
from server.tests.test_vocals import setup, wait

HEADERS = {'origin':'http://studio'}

def entries(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {name:z.read(name) for name in z.namelist()}

def pack(files):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for name,content in files.items(): z.writestr(name,content)
    return output.getvalue()

def upload(client,data):
    # Deliberately misleading extension: validation is based on the container.
    return client.post('/api/v1/project-archives',files={'file':('project.bin',data,'application/octet-stream')},headers=HEADERS)

def test_source_archive_independent_service_round_trip(tmp_path):
    source=tmp_path/'from'; source.mkdir()
    client, db=setup(source)
    with client:
        job=client.post('/api/v1/projects/p/jobs/vocal',json={'params':{'asset_id':'p'}},headers=HEADERS).json()
        assert wait(client,job['id'])['status']=='succeeded'
        envelope=client.get('/api/v1/projects/p/document').json()
        snapshot=envelope['document']
        snapshot['acoustics']={'analysisId':job['id'],'segments':[{'id':'manual','beginMs':25,'endMs':750}]}
        RevisionStore(db,source/'projects').create('p',snapshot,envelope['revision'])
        archive=client.get('/api/v1/projects/p/archive')
        assert archive.status_code==200 and '.lazp' in archive.headers['content-disposition']
        contents=entries(archive.content)
        assert set(contents)=={'manifest.json','project.json','media/source.wav'}
        assert contents['media/source.wav']==(source/'projects/p/source/original').read_bytes()
        assert json.loads(contents['project.json'])['acoustics']=={'analysisId':None,'segments':snapshot['acoustics']['segments']}
        assert client.get('/api/v1/projects/p/document').json()['document']['acoustics']['analysisId']==job['id']
    destination=tmp_path/'to'
    with TestClient(create_app(destination,Settings(None,True,'http://studio'))) as target:
        first=upload(target,archive.content); assert first.status_code==200,first.text
        pid=first.json()['id']; second=upload(target,archive.content)
        assert second.status_code==200 and second.json()['id']!=pid
        project=target.get(f'/api/v1/projects/{pid}').json()
        assert project['asset']['id']!='p'
        imported=target.get(f'/api/v1/projects/{pid}/document').json()
        expected={**snapshot,'acoustics':{'analysisId':None,'segments':snapshot['acoustics']['segments']}}
        assert imported['document']==expected
        assert target.get(f'/api/v1/projects/{pid}/vocals').json()['items']==[]
        assert target.get(f'/api/v1/projects/{pid}/jobs').json()['items']==[]
        body={k:imported[k] for k in ('schema_version','project_id','revision','document')}
        body['document']['acoustics']['segments'][0]['endMs']=800
        saved=target.put(f'/api/v1/projects/{pid}/document',json=body,headers={**HEADERS,'if-match':imported['revision']})
        assert saved.status_code==200,saved.text
        assert entries(target.get(f'/api/v1/projects/{pid}/archive').content)['media/source.wav']==contents['media/source.wav']
        assert target.get(f'/api/v1/projects/{pid}/audio').status_code==200

def no_audio(client):
    pid=client.post('/api/v1/projects',json={'name':'no audio'},headers=HEADERS).json()['id']
    return pid,client.get(f'/api/v1/projects/{pid}/archive').content

def test_no_audio_manual_segments_save_and_export(tmp_path):
    with TestClient(create_app(tmp_path,Settings(None,True,'http://studio'))) as client:
        _,data=no_audio(client); files=entries(data)
        snapshot=json.loads(files['project.json'])
        snapshot['acoustics']={'analysisId':'foreign','segments':[{'id':'hand','beginMs':20,'endMs':4000}]}
        files['project.json']=json.dumps(snapshot)
        result=upload(client,pack(files)); assert result.status_code==200,result.text
        pid=result.json()['id']; project=client.get(f'/api/v1/projects/{pid}').json()
        assert project['asset'] is None
        envelope=client.get(f'/api/v1/projects/{pid}/document').json()
        assert envelope['document']['acoustics']=={'analysisId':None,'segments':snapshot['acoustics']['segments']}
        body={k:envelope[k] for k in ('schema_version','project_id','revision','document')}
        assert client.put(f'/api/v1/projects/{pid}/document',json=body,headers={**HEADERS,'if-match':envelope['revision']}).status_code==200
        assert set(entries(client.get(f'/api/v1/projects/{pid}/archive').content))=={'manifest.json','project.json'}

@pytest.mark.parametrize('fault',['version','format','path','missing','hash','oversize','snapshot','duplicate','badzip','reference'])
def test_invalid_archives_leave_no_project_or_temp_files(tmp_path,fault):
    with TestClient(create_app(tmp_path,Settings(None,True,'http://studio'))) as client:
        _,data=no_audio(client); files=entries(data); manifest=json.loads(files['manifest.json'])
        if fault=='version': manifest['version']=99
        if fault=='format': manifest['format']='unknown'
        if fault=='path': files['../outside']=b'bad'
        if fault in ('missing','hash','oversize'):
            manifest['source']={'path':'media/source.wav','filename':'../original.wav','size':2 if fault!='oversize' else 10**12,'sha256':'0'*64}
            if fault!='missing': files['media/source.wav']=b'xx'
        if fault=='snapshot': files['project.json']='{}'
        if fault=='reference':
            snapshot=json.loads(files['project.json']);snapshot['lineOrder']=['foreign'];files['project.json']=json.dumps(snapshot)
        files['manifest.json']=json.dumps(manifest)
        data=pack(files)
        if fault=='badzip': data=b'not a zip'
        if fault=='duplicate':
            out=io.BytesIO(data)
            with zipfile.ZipFile(out,'a') as z:z.writestr('project.json',files['project.json'])
            data=out.getvalue()
        before=client.get('/api/v1/projects').json()
        result=upload(client,data)
        assert result.status_code==422,result.text
        assert client.get('/api/v1/projects').json()==before
        assert not list(tmp_path.glob('studio-import-*'))
        assert len(list((tmp_path/'projects').iterdir()))==1
