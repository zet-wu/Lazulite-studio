import json
import threading
import time

import pytest
from server.shape_conversion import ROOT, analyze_shapes, parse_output, native_convert, ShapeCancelled


def analyze(text,target='taiwan'):
    return analyze_shapes([{'id':'line','text':text}],target)['rows'][0]['cells']


def value(cells): return ''.join(c['value'] or c['original'] for c in cells)


def test_native_shapes_and_conservative_japanese():
    assert value(analyze('头发 發髮 乾隆皇后'))=='頭髮 發髮 乾隆皇后'
    assert value(analyze('洗浄 弁護士 丁寧'))=='洗淨 辯護士 丁寧'
    assert value(analyze('鼠標 軟件 打印機'))=='鼠標 軟件 打印機'
    assert value(analyze('發髮','simplified'))=='发发'
    assert value(analyze('發髮','japanese'))=='発髪'
    for target in ['simplified','taiwan','hongkong','japanese']:
        cells=analyze('頭发 叶 弁 下面',target)
        for c in cells:
            if c['original'] in '发叶弁下面': assert c['status']=='ambiguous'
    assert value(analyze('裏','taiwan'))=='裡'
    assert value(analyze('裡','hongkong'))=='裏'


def test_explicit_conflicts_are_blank_and_do_not_supply_later_context():
    manifest=json.loads((ROOT/'manifest.json').read_text())
    assert manifest['conflicts']
    for source in manifest['conflicts']:
        cells=analyze(source)
        assert any(c['status']=='failed' and c['value']=='' for c in cells),source


def test_batch_identity_newlines_and_graphemes():
    source='😀𠀀葛\U000E0100 e\u0301\n頭发\r\nかな'
    lines=[{'id':'b','text':source},{'id':'a','text':''},{'id':'c','text':'头发'}]
    rows=analyze_shapes(lines,'taiwan')['rows']
    assert [row['id'] for row in rows]==['b','a','c']
    assert rows[1]['cells']==[]
    cells=rows[0]['cells']
    assert cells[0]['start']==0 and cells[0]['end']==2
    assert cells[2]['original']=='葛\U000E0100' and cells[2]['end']-cells[2]['start']==3
    assert value(cells)==source.replace('发','發')
    assert value(rows[2]['cells'])=='頭髮'


def test_incomplete_and_misaligned_native_output_rejected():
    for output in ['{"lit":"髮"}', '{"lit":"髮髮"}\n{"end":{"output_bytes":6,"ambiguities":0,"sources":0}}', '{"def":"甲"}\n{"amb":{"t":"髮","s":0}}']:
        with pytest.raises(ValueError): parse_output(output,'发',set())


def test_cancelled_and_missing_resources(monkeypatch,tmp_path):
    cancelled=threading.Event();cancelled.set()
    with pytest.raises(ShapeCancelled): native_convert('头发',['MixedShapes'],set(),cancelled)
    monkeypatch.setattr('server.shape_conversion.ROOT',tmp_path)
    with pytest.raises(ValueError,match='执行失败'): native_convert('头发',['missing'],set(),threading.Event())


def test_http_batch_contract_and_error(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server.shape_routes import shape_router
    app=FastAPI();app.include_router(shape_router(write=lambda:None))
    with TestClient(app) as client:
        response=client.post('/shapes/analyze',json={'target':'taiwan','lines':[{'id':'b','text':'头发'},{'id':'a','text':'弁'}]})
        assert response.status_code==200
        assert [row['id'] for row in response.json()['rows']]==['b','a']
        assert response.json()['rows'][1]['cells'][0]['status']=='ambiguous'
        assert client.post('/shapes/analyze',json={'target':'../config','lines':[{'id':'a','text':'发'}]}).status_code==422
        assert client.post('/shapes/analyze',json={'target':'taiwan','lines':[{'id':'a','text':'发'},{'id':'a','text':'发'}]}).status_code==422
        def fail(*args): raise ValueError('missing')
        monkeypatch.setattr('server.shape_routes.analyze_shapes',fail)
        response=client.post('/shapes/analyze',json={'target':'taiwan','lines':[{'id':'a','text':'发'}]})
        assert response.status_code==422 and response.json()['detail']['code']=='shape_failed'


def test_cancellation_stops_a_running_native_process(monkeypatch):
    import sys
    from server import process_supervisor
    spawn=process_supervisor.spawn
    processes=[]
    def slow(*args,**kwargs):
        process=spawn([sys.executable,'-c','import time; time.sleep(10)'],**kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(process_supervisor,'spawn',slow)
    cancelled=threading.Event()
    timer=threading.Timer(.15,cancelled.set);timer.start()
    try:
        with pytest.raises(ShapeCancelled): native_convert('头发',['MixedShapes'],set(),cancelled)
    finally: timer.cancel()
    assert len(processes)==1 and processes[0].poll() is not None
