"""Saved Studio draft -> independent Japanese request, on Unicode code point axes."""
from dataclasses import asdict
from decimal import Decimal
import json
import xml.etree.ElementTree as ET
from lazulite.models.japanese import JapaneseAlignmentRequest, JapaneseLine, JapaneseUnit, StartHint
from lazulite.alignment.japanese.input import prepare_input, InputOptions, nonpronouncing
from lazulite.alignment.japanese.backend import MMS_VOCAB
from .amll_compatibility import TT, TM, XML, ST, RUBY


def project_alignment(snapshot, use_hints=False, *, model=None, latin_normalize=True, strip_tone_digits=False):
    root = ET.fromstring(snapshot['lyrics']['draftTtml'])
    rows = []
    for parent in root.iter(TT+'p'):
        rows.append(parent)
        rows.extend(child for child in parent if child.get(TM+'role') == 'x-bg')
    def identity(node):
        value = node.get(ST+'id') or node.get(XML+'id')
        if not value: raise ValueError('请先保存当前编辑稿，歌词对象缺少稳定标识')
        return value
    by_id = {identity(row): row for row in rows}
    order = snapshot['lineOrder']
    rows = [by_id[key] for key in order] + [row for row in rows if identity(row) not in order]
    skipped = set(snapshot['editing']['skippedAlignmentLineIds'])
    mapping, lines, unknown, hinted, emitted = [], [], set(), 0, 0
    scope = []
    for row in rows:
        line_id = identity(row)
        if line_id in skipped: continue
        words = [child for child in row if child.tag == TT+'span' and not any(role != 'expletive' for role in child.get(TM+'role', '').split())]
        text, units = '', []
        for wi, word in enumerate(words):
            rubies = [node for node in word.iter(TT+'span') if node.get(RUBY) == 'text']
            base = next((node for node in word if node.get(RUBY) == 'base'), word)
            value = ''.join(base.itertext())
            if row.get(TM+'role') == 'x-bg':
                if wi == 0 and value.startswith('('): value = value[1:]
                if wi == len(words)-1 and value.endswith(')'): value = value[:-1]
            start = len(text); text += value
            for leaf in rubies or [word]:
                scope.append({'object_id':identity(leaf), 'word_id':identity(word), 'line_id':line_id,
                              'kind':'ruby' if rubies else 'word', 'target_ids':[]})
            if not value: continue
            for leaf in rubies or [word]:
                reading = ''.join(leaf.itertext()) if rubies else value
                if nonpronouncing(reading):
                    continue
                uid = identity(leaf)
                units.append(JapaneseUnit(uid, (start,len(text)), reading, 'unknown', 'ruby' if rubies else 'body'))
                mapping.append({'unit_id':uid,'object_id':uid,'word_id':identity(word),'line_id':line_id,'kind':'ruby' if rubies else 'word'})
        hint = None
        if 'begin' not in row.get(ST+'null', '').split() and row.get('begin') is not None:
            value = Decimal(0)
            for part in row.get('begin').split(':'): value = value*60 + Decimal(part)
            hinted += 1
            if use_hints: hint = StartHint(float(value), 'unknown')
        lines.append(JapaneseLine(line_id, text, tuple(units), hint))
    original_readings = {u.unit_id:u.reading for l in lines for u in l.units}
    original_mapping = {m['unit_id']:m for m in mapping}
    vocabulary = model['vocabulary'] if model else MMS_VOCAB
    blank = model['blank'] if model else 0
    special = tuple(k for k in vocabulary if len(k)!=1 or k=='|')
    prepared = prepare_input(JapaneseAlignmentRequest(tuple(lines)), vocabulary, blank, special,
                             InputOptions(latin_normalize, strip_tone_digits))
    request = prepared['request']
    mapping = [{**original_mapping[origin], 'unit_id':uid} for uid,origin in prepared['origins'].items()]
    unknown = {original_mapping[prepared['origins'][uid]]['object_id'] for uid,reason in prepared['problems'].items() if reason != 'profile_hold'}
    emitted = sum(b>a for a,b in prepared['ranges'].values())
    by_object = {item['object_id']:item for item in scope}
    for item in mapping:
        by_object[item['object_id']]['target_ids'].append(item['unit_id'])
    return {'request': {'schema': 'lazulite-japanese-request-v1', **asdict(request)}, 'mapping': mapping, 'scope': scope,
            'summary': {'unknown_objects': sorted(unknown), 'input_version':prepared['version'], 'inputs':[{'unit_id':u.unit_id,'object_id':original_mapping[prepared['origins'][u.unit_id]]['object_id'],'reading':u.reading,'original_reading':original_readings[prepared['origins'][u.unit_id]],'reading_range':u.reading_range,'model_text':prepared['texts'][u.unit_id],'problem':prepared['problems'].get(u.unit_id),'unknown_characters':prepared['unknown_characters'].get(u.unit_id,[])} for l in request.lines for u in l.units], 'line_count': len(lines), 'skipped_count': len(skipped), 'unknown_count': len(unknown), 'hint_count': hinted, 'emitting_count': emitted}}
