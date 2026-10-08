"""Project constraints; read-only checks on the full persisted TTML."""
import xml.etree.ElementTree as ET
TT='{http://www.w3.org/ns/ttml}'
TM='{http://www.w3.org/ns/ttml#metadata}'
XML='{http://www.w3.org/XML/1998/namespace}'
ST='{urn:lazulite:studio:draft}'
RUBY='{http://www.w3.org/ns/ttml#styling}ruby'
DEFAULTS={'simplified':False,'noMultipleBackgrounds':True,'noChorus':False,'noWordAgents':True,'noIndependentBackground':False}

def validate_amll(snapshot):
    flags=snapshot['amll']
    if flags['simplified'] and not all(flags[key] for key in ('noChorus','noWordAgents','noIndependentBackground')):
        raise ValueError('简化模型依赖限制必须开启')
    root=ET.fromstring(snapshot['lyrics']['draftTtml'])
    issues=set()
    agents=list(root.iter(TM+'agent'))
    if any(a.get(XML+'id') not in ('v1','v2') or a.get('type')!='person' or len(a) for a in agents):issues.add('simplified')
    background_ids=set()
    line_ids={node.get(XML+'id') for node in root.iter(TT+'p')}
    def refs(node):return node.get(TM+'agent','').split()
    def words(node):return [child for child in node if child.tag==TT+'span' and child.get(TM+'role')!='x-bg' and child.get(RUBY) in (None,'container') and not any(role in ('x-translation','x-roman') for role in child.get(TM+'role','').split())]
    def check_line(node,effective,parent=None):
        if len(refs(node))>1:issues.add('noChorus')
        if parent is not None and set(effective)!=set(parent):issues.add('noIndependentBackground')
        for word in words(node):
            own=refs(word)
            if own:issues.add('noWordAgents')
            if len(own)>1:issues.add('noChorus')
            if parent is not None and set(own or effective)!=set(parent):issues.add('noIndependentBackground')
    for line in root.iter(TT+'p'):
        backgrounds=[child for child in line if child.get(TM+'role')=='x-bg']
        if len(backgrounds)>1:issues.add('noMultipleBackgrounds')
        check_line(line,refs(line))
        for bg in backgrounds:
            background_ids.add(bg.get(ST+'id') or bg.get(XML+'id'))
            check_line(bg,refs(bg) or refs(line),refs(line))
    before=snapshot['lineOrder']
    if len(set(before))!=len(before) or any(key not in background_ids|line_ids for key in before):raise ValueError('背景前置引用无效')
    for key in issues:
        if flags[key] or flags['simplified'] and key in ('noChorus','noWordAgents','noIndependentBackground'):
            raise ValueError(f'AMLL 项目限制不满足：{key}')
