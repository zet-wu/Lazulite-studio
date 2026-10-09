"""Saved Studio draft -> independent Japanese request, on Unicode code point axes."""
from dataclasses import asdict
from decimal import Decimal
import json
import unicodedata as ud
import xml.etree.ElementTree as ET
from lazulite.models.japanese import JapaneseAlignmentRequest, JapaneseLine, JapaneseUnit, StartHint
from lazulite.alignment.japanese.kana import is_kana_text, split_morae
from lazulite.alignment.japanese.profile import JaHepburnProfile, is_hold
from .amll_compatibility import TT, TM, XML, ST, RUBY


def normalized(text):
    return ud.normalize('NFKC', text.replace('～', 'ー').replace('〜', 'ー'))


def category(text):
    value = normalized(text)
    if is_kana_text(value) or is_hold(value): return 'ja'
    if any(c.isascii() and c.isalpha() for c in value) and all(c.isascii() and (c.isalpha() or c in "'’") for c in value): return 'en'
    if all(c.isspace() or ud.category(c)[0] in {'P','S'} for c in text): return 'separator'
    return 'unknown'


def runs(text):
    clusters = []
    for i, char in enumerate(text):
        if ud.category(char).startswith('M') and clusters:
            clusters[-1][1] += char
        else: clusters.append([i, char])
    output = []
    for start, value in clusters:
        kind = category(value)
        if output and output[-1][2] == kind:
            output[-1][1] += value
        else: output.append([start, value, kind])
    return output


def project_alignment(snapshot, use_hints=False):
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
    unit_counts = {}
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
            def add(object_id, reading, language, a, b, source):
                nonlocal emitted
                if language == 'separator': return
                pieces = [m.text for m in split_morae(normalized(reading))] if language == 'ja' else [normalized(reading)]
                reading_offset = 0
                for piece in pieces:
                    uid = json.dumps([object_id, unit_counts.get(object_id, 0)], ensure_ascii=False, separators=(',', ':'))
                    unit_counts[object_id] = unit_counts.get(object_id, 0) + 1
                    units.append(JapaneseUnit(uid, (a, b), piece, language, source, (reading_offset, reading_offset+len(piece)) if piece else None))
                    mapping.append({'unit_id': uid, 'object_id': object_id, 'word_id': identity(word), 'line_id': line_id, 'kind': 'ruby' if rubies else 'word'})
                    reading_offset += len(piece)
                if language == 'unknown': unknown.add(object_id)
            if rubies:
                for ruby in rubies:
                    reading = ''.join(ruby.itertext())
                    # Invalid Ruby is one unknown object, never a fallback to body text.
                    lang = category(reading) if category(reading) in {'ja','separator'} else 'unknown'
                    add(identity(ruby), reading, lang, start, len(text), 'ruby')
            else:
                for offset, part, lang in runs(value):
                    add(identity(word), part, lang, start+offset, start+offset+len(part), 'body')
        hint = None
        if 'begin' not in row.get(ST+'null', '').split() and row.get('begin') is not None:
            value = Decimal(0)
            for part in row.get('begin').split(':'): value = value*60 + Decimal(part)
            hinted += 1
            if use_hints: hint = StartHint(float(value), 'unknown')
        lines.append(JapaneseLine(line_id, text, tuple(units), hint))
        profile = JaHepburnProfile().unit_texts([u.reading if u.reading_language != 'unknown' else '' for u in units], [u.reading_language for u in units], [[] for _ in units])
        emitted += sum(bool(v) for v in profile)
    by_object = {item['object_id']:item for item in scope}
    for item in mapping:
        by_object[item['object_id']]['target_ids'].append(item['unit_id'])
    request = JapaneseAlignmentRequest(tuple(lines))
    return {'request': {'schema': 'lazulite-japanese-request-v1', **asdict(request)}, 'mapping': mapping, 'scope': scope,
            'summary': {'line_count': len(lines), 'skipped_count': len(skipped), 'unknown_count': len(unknown), 'hint_count': hinted, 'emitting_count': emitted}}
