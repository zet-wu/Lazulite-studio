"""Prepare a release draft with completed archives; never publish automatically."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote

TARGETS = ('windows-x64-cpu', 'windows-x64-cuda', 'macos-arm64')


def assets_in(directory):
    files = sorted(Path(directory).iterdir())
    groups = {target: [] for target in TARGETS}
    for path in files:
        match = re.fullmatch(r'LazuliteStudio-(windows-x64-cpu|windows-x64-cuda|macos-arm64)\.7z(?:\.(\d{3,}))?', path.name)
        if not match or not path.is_file() or not 0 < path.stat().st_size < 2 * 1024**3:
            raise ValueError(f'无效 Release 附件或超过单附件限制：{path}')
        groups[match[1]].append(int(match[2]) if match[2] else 0)
    for target, parts in groups.items():
        if not parts or (parts != [0] and (len(parts) < 2 or sorted(parts) != list(range(1, len(parts) + 1)))):
            raise ValueError(f'{target} 附件缺失、分卷不连续或混入完整包')
    return files


def api(endpoint, *args):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint, *args], text=True))


def prepare_draft(directory):
    files = assets_in(directory)
    tag = os.environ['RELEASE_TAG']
    commit = os.environ['RELEASE_COMMIT']
    refs = api('repos/{owner}/{repo}/git/matching-refs/tags/' + quote(tag, safe=''))
    if any(ref['ref'] == 'refs/tags/' + tag for ref in refs):
        actual = api('repos/{owner}/{repo}/commits/' + quote(tag, safe=''))['sha']
        if actual != commit:
            raise ValueError('标签已移动，拒绝将其他提交的构建附到该标签')
    pages = api('repos/{owner}/{repo}/releases', '--paginate', '--slurp')
    existing = next((item for page in pages for item in page if item['tag_name'] == tag), None)
    if existing and not existing['draft']:
        raise ValueError('该版本已经发布，请使用新版本号；不会覆盖已发布附件')
    notes = f'''Lazulite Studio {tag} 预发布\n\n源码提交：{commit}\n\n下载适合系统的完整 .7z 包。CUDA 若有分卷，下载全部 .7z.001、.7z.002 等文件，放在同一目录，从 .001 解压。\n\nWindows：双击 start.exe；macOS：双击 start.command。详细说明见包内 USAGE.txt。\n\nmacOS 未经开发者签名或公证；此版本标记为预发布，供试用反馈。\n'''
    if existing:
        # Preserve the user's title and release notes. Pin a new tag to the built SHA.
        subprocess.run(['gh', 'release', 'edit', tag, '--draft', '--prerelease',
                        '--target', commit], check=True)
        # Clear old managed archives so a failed rerun cannot mix build versions.
        for asset in existing['assets']:
            if re.fullmatch(r'LazuliteStudio-(windows-x64-cpu|windows-x64-cuda|macos-arm64)\.7z(?:\.\d{3,})?', asset['name']):
                subprocess.run(['gh', 'release', 'delete-asset', tag, asset['name'], '--yes'], check=True)
    else:
        with tempfile.TemporaryDirectory() as temp:
            body = Path(temp) / 'release-notes.txt'
            body.write_text(notes, encoding='utf-8')
            subprocess.run(['gh', 'release', 'create', tag, '--target', commit, '--draft', '--prerelease',
                            '--title', f'Lazulite Studio {tag}', '--notes-file', str(body)], check=True)
    for path in files:
        subprocess.run(['gh', 'release', 'upload', tag, str(path)], check=True)
    print(f'Release draft {tag} is ready; review and publish it on GitHub.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    prepare_draft(parser.parse_args().assets)
