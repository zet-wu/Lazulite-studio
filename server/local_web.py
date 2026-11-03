"""Production SPA hosting."""
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse


def mount_frontend(app, directory):
    root = Path(directory).resolve()
    if not (root / 'index.html').is_file(): raise RuntimeError('缺少前端 dist，请恢复完整程序包')

    @app.get('/{resource:path}', include_in_schema=False)
    def frontend(resource: str):
        if resource == 'api' or resource.startswith('api/'):
            raise HTTPException(404, 'API 不存在')
        path = (root / resource).resolve()
        if not path.is_relative_to(root): raise HTTPException(404)
        if path.is_file(): return FileResponse(path)
        # Only product page routes may fall back; missing JS/fonts are true 404s.
        import re
        if resource in {'', 'projects', 'settings', 'login', 'editor'} or re.fullmatch(r'projects/[a-zA-Z0-9_-]+/edit', resource):
            return FileResponse(root / 'index.html', headers={'Cache-Control': 'no-cache'})
        raise HTTPException(404)
