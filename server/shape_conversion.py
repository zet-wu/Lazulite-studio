"""Native OpenCC shape analysis with explicit source conflicts and positional output."""
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import uuid

import regex
from . import process_supervisor

ROOT = Path(__file__).parent / 'vendor/opencc-shapes'


class ShapeCancelled(Exception):
    pass


def parse_output(raw, source, conflicts):
    """All bundled dictionary candidates preserve code-point positions.

    Each native segment and the completion footer are checked at this external
    boundary; byte counts are never interpreted as character offsets.
    """
    definitions, output, states = [], [], []
    ended = False
    ambiguity_count = 0
    for line in raw.splitlines():
        record = json.loads(line)
        if ended or len(record)!=1: raise ValueError('转换程序输出格式错误')
        if 'def' in record:
            if not isinstance(record['def'],str): raise ValueError('转换来源格式错误')
            definitions.append(record['def'])
            continue
        if 'end' in record:
            end=record['end']
            if end != {'output_bytes':len(''.join(output).encode('utf-8')), 'ambiguities':ambiguity_count,'sources':len(definitions)}:
                raise ValueError('转换程序完成记录不匹配')
            ended=True
            continue
        status='known'
        if 'lit' in record:
            text=record['lit']
        elif 'amb' in record:
            amb=record['amb']
            index=amb['s']
            if not isinstance(index,int) or not 0<=index<len(definitions): raise ValueError('转换歧义来源无效')
            text=amb['t']; original=definitions[index]
            position=len(states)
            if source[position:position+len(original)]!=original or len(text)!=len(original):
                raise ValueError('转换片段无法对应原位置')
            status='failed' if original in conflicts else 'ambiguous'
            ambiguity_count+=1
        else: raise ValueError('未知转换记录')
        if not isinstance(text,str): raise ValueError('转换文本格式错误')
        output.append(text);states.extend([status]*len(text))
    text=''.join(output)
    if not ended or len(text)!=len(source): raise ValueError('转换结果不完整或无法对应原位置')
    return text, states


def native_convert(text, tables, conflicts, cancelled):
    import opencc
    if importlib.metadata.version('OpenCC')!='1.4.2': raise ValueError('需要 OpenCC 1.4.2 转换资源')
    executable=Path(opencc.__file__).parent/'clib/bin'/('opencc.exe' if os.name=='nt' else 'opencc')
    dictionaries=[{'type':'ocd2','file':str((ROOT/(table+'.ocd2')).resolve())} for table in tables]
    dictionary=dictionaries[0] if len(dictionaries)==1 else {'type':'group','match_policy':'short_circuit','dicts':dictionaries}
    config={'name':'Studio shapes','conversion_chain':[{'dict':dictionary}]}
    with tempfile.TemporaryDirectory(prefix='studio-shapes-') as directory:
        path=Path(directory)/'config.json';path.write_text(json.dumps(config),encoding='utf-8')
        if cancelled.is_set(): raise ShapeCancelled()
        process=process_supervisor.spawn([str(executable),'-c',str(path),'--ambiguities'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            first=True
            while True:
                if cancelled.is_set(): raise ShapeCancelled()
                try:
                    stdout,stderr=process.communicate(text.encode('utf-8') if first else None,timeout=.1)
                    break
                except subprocess.TimeoutExpired: first=False
            if process.returncode: raise ValueError('转换程序执行失败：'+stderr.decode('utf-8',errors='replace')[:300])
            return parse_output(stdout.decode('utf-8'),text,conflicts)
        finally: process_supervisor.stop(process)


def analyze_shapes(lines, target, cancelled=None):
    cancelled=cancelled or threading.Event()
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    tables=manifest['targets'][target]
    # An explicit, request-unique frame separates rows even when lyrics include
    # newlines. It cannot be matched by any bundled Han dictionary entry.
    separator='\n'+uuid.uuid4().hex+'\n'
    while any(separator in line['text'] for line in lines): separator='\n'+uuid.uuid4().hex+'\n'
    source=separator.join(line['text'] for line in lines)
    normalized,first=native_convert(source,['MixedShapes'],set(manifest['conflicts']),cancelled)
    # Unresolved defaults must not influence later phrase context.
    normalized=''.join('\ufffc' if status=='failed' else c for c,status in zip(normalized,first))
    converted,second=native_convert(normalized,tables,set(),cancelled)
    rows=[];offset=0
    for line in lines:
        text=line['text'];cells=[];utf16=0
        for match in regex.finditer(r'\X',text):
            start,end=match.span();a,b=offset+start,offset+end
            original=match.group();value=converted[a:b]
            statuses=first[a:b]+second[a:b]
            status='failed' if 'failed' in statuses else 'ambiguous' if 'ambiguous' in statuses else 'known'
            # Combining sequences/IVS remain whole, including supplementary Han.
            if len(regex.findall(r'\X',value))!=1: status='failed'
            next_utf16=utf16+len(original.encode('utf-16-le'))//2
            cells.append({'start':utf16,'end':next_utf16,
                          'original':original,'value':'' if status=='failed' else value,'status':status})
            utf16=next_utf16
        rows.append({'id':line['id'],'cells':cells});offset+=len(text)
        if offset<len(source):
            if converted[offset:offset+len(separator)]!=separator or normalized[offset:offset+len(separator)]!=separator:
                raise ValueError('转换结果行边界无效')
            offset+=len(separator)
    if cancelled.is_set(): raise ShapeCancelled()
    return {'rows':rows}
