"""Download vocal models with the bundled isolated interpreter."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    downloader = runpy.run_path(str(Path(__file__).resolve().with_name('download_models.py')))
    raise SystemExit(downloader['main']('vocal'))
