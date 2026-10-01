from server.tests.test_project_deletion import setup_project
from server.search_conditions import initial_conditions
from mutagen.flac import FLAC
import subprocess


def test_final_strings_clear_reopen_and_old_project_no_backfill(tmp_path):
    client, headers, asset, (pid, other), db = setup_project(tmp_path)
    url = f'/api/v1/projects/{pid}/search-conditions'
    assert client.get(url).json() == {'title': 'song', 'artist': '', 'album': ''}
    values = {'title': 'custom (Live)', 'artist': 'A B, C', 'album': ''}
    assert client.put(url, json=values, headers=headers).json() == values
    assert client.get(url).json() == values
    empty = dict.fromkeys(values, '')
    assert client.put(url, json=empty, headers=headers).json() == empty
    assert client.get(url).json() == empty
    with db.transaction() as c: c.execute('DELETE FROM search_conditions WHERE project_id=?', (other,))
    assert client.get(f'/api/v1/projects/{other}/search-conditions').json() == empty
    assert client.get(f'/api/v1/projects/{pid}/lyrics').text.find('custom') == -1
    assert client.put(url, json={'title': 'x'*2001, 'artist': '', 'album': ''}, headers=headers).status_code == 422


def test_tags_all_nonempty_values_and_filename_fallback(tmp_path):
    path = tmp_path / 'source.bin'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','0.1','-f','flac',str(path)],check=True)
    audio = FLAC(path); audio['title'] = [' First ', '', 'Second (Live)']; audio['artist'] = ['A','B']; audio['album'] = ['One','Two']; audio.save()
    expected = {'title': 'First Second (Live)', 'artist': 'A B', 'album': 'One Two'}
    assert initial_conditions(path, 'uploaded.music.flac') == expected
    del audio['title']; audio.save()
    assert initial_conditions(path, 'uploaded.music.flac')['title'] == 'uploaded.music'
