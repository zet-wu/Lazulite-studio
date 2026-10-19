"""Dictionary segments, keyed by exact surface AND selected reading."""
from functools import lru_cache
import gzip
import json
from pathlib import Path

RESOURCE = Path(__file__).parent / 'vendor/jmdict-furigana/JmdictFurigana.json.gz'


def build_index(entries):
    if not isinstance(entries, list): raise ValueError('词典须为条目数组')
    variants = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('text'), str) or not isinstance(entry.get('reading'), str) or not isinstance(entry.get('furigana'), list):
            raise ValueError('词典条目须包含 text、reading 字符串和 furigana 数组')
        if any(not isinstance(part, dict) or not isinstance(part.get('ruby'), str) or ('rt' in part and not isinstance(part['rt'], str)) for part in entry['furigana']):
            raise ValueError('词典分段须包含 ruby 字符串及可选 rt 字符串')
        surface, reading = entry['text'], entry['reading']
        parts = tuple((p['ruby'], p.get('rt', p['ruby'])) for p in entry['furigana'])
        if not parts or any(not base or not rt for base, rt in parts):
            continue
        if ''.join(p[0] for p in parts) != surface or ''.join(p[1] for p in parts) != reading:
            continue
        variants.setdefault((surface, reading), set()).add(parts)
    return {key: next(iter(values)) for key, values in variants.items() if len(values) == 1}


@lru_cache(maxsize=1)
def load_index():
    raw = gzip.decompress(RESOURCE.read_bytes())
    return build_index(json.loads(raw.decode('utf-8-sig')))


def token_segments(token, index, mode_a, hiragana):
    """C reading is authoritative; A is usable only if every boundary recomposes."""
    base, reading, start = token.surface(), hiragana(token.reading_form()), token.begin()
    exact = index.get((base, reading))
    if exact is not None:
        parts = exact
    else:
        children = list(token.split(mode_a))
        cursor = start
        consistent = bool(children)
        for child in children:
            consistent &= child.begin() == cursor and child.end() - child.begin() == len(child.surface())
            cursor = child.end()
        consistent &= cursor == token.end() and ''.join(c.surface() for c in children) == base
        consistent &= ''.join(hiragana(c.reading_form()) for c in children) == reading
        parts = tuple(p for child in children for p in index.get(
            (child.surface(), hiragana(child.reading_form())),
            ((child.surface(), hiragana(child.reading_form())),)
        )) if consistent else ((base, reading),)
    result = []
    for surface, value in parts:
        result.append((start, start + len(surface), surface, value))
        start += len(surface)
    return result
