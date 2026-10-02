import pytest
from server.documents import validate_ttml
from server.publish import validate_publish_ttml, PublishInvalid

SOURCE = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><metadata><ttm:agent xml:id="role" type="character"><ttm:actor agent="actor"/></ttm:agent><ttm:agent xml:id="actor" type="person"/></metadata></head><body><div><p begin="00:00.000" end="00:01.000">歌</p></div></body></tt>'

def test_actor_forward_reference_and_missing_target():
    assert validate_ttml(SOURCE) == SOURCE
    with pytest.raises(ValueError, match='actor'):
        validate_ttml(SOURCE.replace('agent="actor"', 'agent="missing"'))

@pytest.mark.parametrize('attribute', ['', 'type="invalid"'])
def test_agent_type_draft_allowed_publish_rejected(tmp_path, attribute):
    text = SOURCE.replace('type="person"', attribute)
    assert validate_ttml(text) == text
    path = tmp_path / 'lyric.ttml'
    path.write_text(text)
    with pytest.raises(PublishInvalid, match='type'):
        validate_publish_ttml(path)
