"""Publish completed archives; never unpack or hash them again."""
import argparse
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


def publish(directory):
    files = assets_in(directory)
    tag = os.environ['RELEASE_TAG']
    commit = os.environ['RELEASE_COMMIT']
    actual = subprocess.check_output(['gh', 'api',
        'repos/{owner}/{repo}/commits/' + quote(tag, safe=''), '--jq', '.sha'], text=True).strip()
    if actual != commit:
        raise ValueError('标签已移动，拒绝将其他提交的构建发布到该标签')
    # Fail on existing releases instead of overwriting published user downloads.
    # A failed upload leaves a draft for inspection; delete that draft before retrying.
    notes = f'''Lazulite Studio {tag} 预发布\n\n源码提交：{commit}\n\n下载适合系统的完整 .7z 包。CUDA 若有分卷，下载全部 .7z.001、.7z.002 等文件，放在同一目录，从 .001 解压。\n\nWindows：双击 start.exe；macOS：双击 start.command。详细说明见包内 USAGE.txt。\n\nmacOS 未经开发者签名或公证；此版本标记为预发布，供试用反馈。\n'''
    with tempfile.TemporaryDirectory() as temp:
        body = Path(temp) / 'release-notes.txt'
        body.write_text(notes, encoding='utf-8')
        subprocess.run(['gh', 'release', 'create', tag, '--verify-tag', '--draft', '--prerelease',
                        '--title', f'Lazulite Studio {tag}', '--notes-file', str(body)], check=True)
    for path in files:
        subprocess.run(['gh', 'release', 'upload', tag, str(path)], check=True)
    subprocess.run(['gh', 'release', 'edit', tag, '--draft=false', '--prerelease', '--latest=false'], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    publish(parser.parse_args().assets)
