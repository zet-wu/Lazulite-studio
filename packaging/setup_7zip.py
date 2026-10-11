"""Fetch pinned build-only 7-Zip; never install it into the application."""
import argparse
import os
from pathlib import Path
import platform

from archive import download, extract

SOURCES = {
    'Windows': ('7zr.exe', '256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282'),
    'Darwin': ('7z2604-mac.tar.xz', 'bee04358cbcbc7106273cee0e8d72916db2696c48067a3538c34d8cd6fd16578'),
    'Linux': ('7z2604-linux-x64.tar.xz', 'fc0327ba27e89bd086cf426dff17d77de582953cdbbc10a6576540a06853ffcd'),
}


def setup(destination):
    destination = Path(destination).resolve()
    name, sha = SOURCES[platform.system()]
    archive = download('https://github.com/ip7z/7zip/releases/download/26.04/' + name, destination / name, sha)
    if name.endswith('.exe'):
        executable = archive
    else:
        extract(archive, destination / 'unpacked')
        executable = destination / 'unpacked/7zz'
        executable.chmod(0o755)
    return executable


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    executable = setup(parser.parse_args().destination)
    print(executable)
    if os.environ.get('GITHUB_ENV'):
        with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as env:
            env.write(f'STUDIO_7ZIP={executable}\n')
