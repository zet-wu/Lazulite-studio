"""Project-only karaoke data. Invalid timing is editable and checked on export."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Group(Model):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)

class Defaults(Model):
    text: str = Field(min_length=1)
    beforeMs: StrictInt = Field(ge=0)
    wordMs: StrictInt = Field(ge=0)
    rubyMs: StrictInt = Field(ge=0)

class Before(Model):
    kind: Literal['before']
    lineId: str

class WordAnchor(Model):
    kind: Literal['word']
    lineId: str
    leftId: str
    rightId: str

class RubyAnchor(Model):
    kind: Literal['ruby']
    lineId: str
    wordId: str
    leftId: str
    rightId: str

class Cue(Model):
    id: str = Field(min_length=1)
    text: str
    anchor: Before | WordAnchor | RubyAnchor = Field(discriminator='kind')
    beginMs: StrictInt
    endMs: StrictInt

class SingerMarker(Model):
    agentIds: list[str] = Field(min_length=1)
    skip: bool
    trigger: str
    beforeImage: str
    afterImage: str
    sizeMode: Literal['Zoom', 'Fix']
    zoom: str
    noDecor: bool
    forceWipeDecor: bool
    marginLeft: StrictInt
    marginRight: StrictInt
    marginBottom: StrictInt

class Karaoke(Model):
    singerMarkers: list[SingerMarker]
    groups: list[Group]
    lineGroups: dict[str, str]
    defaults: Defaults
    cues: list[Cue]
    outputs: list[str]

    @model_validator(mode='after')
    def identities(self):
        import json
        keys = [tuple(sorted(marker.agentIds)) for marker in self.singerMarkers]
        if len(set(keys)) != len(keys) or any(not all(marker.agentIds) or len(set(marker.agentIds)) != len(marker.agentIds) for marker in self.singerMarkers):
            raise ValueError('invalid singer marker identities')
        groups = {g.id for g in self.groups}
        if len(groups) != len(self.groups) or len({c.id for c in self.cues}) != len(self.cues):
            raise ValueError('duplicate karaoke identity')
        for output in self.outputs:
            parts = json.loads(output)
            if not isinstance(parts, list) or len(parts) != 3 or not all(isinstance(p, str) for p in parts) or parts[1] not in ['body', 'translation', 'romanization']:
                raise ValueError('invalid karaoke output')
        return self


def initial_karaoke(ttml):
    import xml.etree.ElementTree as ET
    root = ET.fromstring(ttml)
    studio, xml, ttm = '{urn:lazulite:studio:draft}', '{http://www.w3.org/XML/1998/namespace}', '{http://www.w3.org/ns/ttml#metadata}'
    groups = {}
    for node in root.iter():
        if node.tag == '{http://www.w3.org/ns/ttml}p' or node.get(ttm+'role') == 'x-bg':
            key = node.get(studio+'id') or node.get(xml+'id')
            if key: groups[key] = 'background' if node.get(ttm+'role') == 'x-bg' else 'main'
    return {'singerMarkers': [], 'groups': [{'id': 'main', 'name': '主歌词'}, {'id': 'background', 'name': '背景歌词'}],
            'lineGroups': groups, 'defaults': {'text': '●', 'beforeMs': 3000, 'wordMs': 500, 'rubyMs': 500},
            'cues': [], 'outputs': ['["main","body",""]', '["background","body",""]']}
