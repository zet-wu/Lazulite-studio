"""Saved Studio draft -> independent Japanese request, on Unicode code point axes."""
from dataclasses import asdict, replace
import xml.etree.ElementTree as ET
from lazulite.models.japanese import JapaneseAlignmentRequest, JapaneseLine, JapaneseUnit, StartHint
from lazulite.alignment.japanese.input import prepare_input, InputOptions, nonpronouncing
from lazulite.alignment.japanese.backend import MMS_VOCAB
from .amll_compatibility import TT, TM, XML, ST, RUBY
from .time_units import parse_ttml_seconds


def build_alignment_projection(snapshot, use_hints=False, *, model=None, latin_normalize=True, strip_tone_digits=False, convert_particles=False, particle_analyzer=None, scope_ids=None):
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
    order_set = set(order)
    rows = [by_id[key] for key in order] + [row for row in rows if identity(row) not in order_set]
    selected = set(scope_ids) if scope_ids is not None else None
    skipped = set() if selected is not None else set(snapshot['editing']['skippedAlignmentLineIds'])
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
            leaves = [leaf for leaf in rubies or [word] if selected is None or identity(leaf) in selected]
            if not leaves: continue
            start = len(text); text += value
            for leaf in leaves:
                scope.append({'object_id':identity(leaf), 'word_id':identity(word), 'line_id':line_id,
                              'kind':'ruby' if rubies else 'word', 'target_ids':[]})
            if not value: continue
            for leaf in leaves:
                reading = ''.join(leaf.itertext()) if rubies else value
                if nonpronouncing(reading):
                    continue
                uid = identity(leaf)
                units.append(JapaneseUnit(uid, (start,len(text)), reading, 'unknown', 'ruby' if rubies else 'body'))
                mapping.append({'unit_id':uid,'object_id':uid,'word_id':identity(word),'line_id':line_id,'kind':'ruby' if rubies else 'word'})
        if selected is not None and not any(item['line_id'] == line_id for item in scope): continue
        hint = None
        if 'begin' not in row.get(ST+'null', '').split() and row.get('begin') is not None:
            value = parse_ttml_seconds(row.get('begin'))
            hinted += 1
            if use_hints: hint = StartHint(float(value), 'unknown')
        lines.append(JapaneseLine(line_id, text, tuple(units), hint))
    original_readings = {u.unit_id:u.reading for l in lines for u in l.units}
    if latin_normalize and convert_particles:
        if particle_analyzer is None:
            from .reading import SudachiReadingProposer
            particle_analyzer = SudachiReadingProposer()
        ranges = particle_analyzer.particles([{'id': line.line_id, 'text': line.text} for line in lines])
        positions_by_line: dict[str, dict[int, str]] = {}
        for item in ranges:
            positions_by_line.setdefault(item['line_id'], {})[item['start']] = item['reading']
        converted = []
        for line in lines:
            positions = positions_by_line.get(line.line_id, {})
            units = tuple(replace(unit, reading=''.join(positions.get(unit.source_range[0] + index, char) for index, char in enumerate(unit.reading)))
                          if unit.reading_source == 'body' else unit for unit in line.units)
            converted.append(replace(line, units=units))
        lines = converted
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


def project_alignment(snapshot, use_hints=False, **options):
    """Validate an external selection while projecting a preview or a submitted run."""
    scope_ids = options.get('scope_ids')
    selected = set(scope_ids) if scope_ids is not None else None
    if selected is not None and (len(selected) != len(scope_ids) or len(selected) < 2):
        raise ValueError('局部对齐至少需要两个不同读音单元')
    projection = build_alignment_projection(snapshot, use_hints, **options)
    if selected is not None and {item['object_id'] for item in projection['scope']} != selected:
        raise ValueError('局部对齐范围与当前读音单元不匹配')
    return projection


def alignment_envelope(snapshot, scope_ids, envelope_ids=None):
    """Selected leaves and their requested parent envelopes, without padding."""
    selected = set(scope_ids)
    points = []
    root = ET.fromstring(snapshot['lyrics']['draftTtml'])
    if envelope_ids is not None:
        if not scope_ids or not isinstance(envelope_ids, list) or not envelope_ids or any(not isinstance(value, str) or not value for value in envelope_ids):
            raise ValueError('局部对齐包络范围无效')
        envelopes = {}
        for row in root.iter():
            if row.tag != TT+'p' and row.get(TM+'role') != 'x-bg': continue
            words = [word for word in row if word.tag == TT+'span' and not any(role != 'expletive' for role in word.get(TM+'role', '').split())]
            row_id = row.get(ST+'id') or row.get(XML+'id')
            row_targets = {row_id}
            for word in words:
                word_id = word.get(ST+'id') or word.get(XML+'id')
                leaves = [leaf for leaf in word.iter(TT+'span') if leaf.get(RUBY) == 'text'] or [word]
                leaf_ids = {leaf.get(ST+'id') or leaf.get(XML+'id') for leaf in leaves}
                if selected & leaf_ids:
                    envelopes[word_id] = {word_id} | leaf_ids
                row_targets.update({word_id} | leaf_ids)
            if selected & row_targets: envelopes[row_id] = row_targets
        if not set(envelope_ids) <= envelopes.keys(): raise ValueError('局部对齐包络引用了无关或不存在的行/词')
        selected.update(target for identity in envelope_ids for target in envelopes[identity])
    for node in root.iter():
        if (node.get(ST+'id') or node.get(XML+'id')) not in selected: continue
        missing = node.get(ST+'null', '').split()
        for side in ('begin', 'end'):
            if side in missing: continue
            value = parse_ttml_seconds(node.get(side))
            if value is not None: points.append(round(float(value)*1000))
    if not points or min(points) >= max(points): raise ValueError('所选单元没有有效时间包络，请先设置起止时间')
    return min(points), max(points)
