"""Local-only request boundary and production SPA hosting."""
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse


class LocalBoundary:
    def __init__(self, app, origin):
        self.app = app
        self.origin = origin
        self.host = urlsplit(origin).netloc.encode('ascii')

    async def __call__(self, scope, receive, send):
        if scope['type'] not in {'http', 'websocket'}:
            return await self.app(scope, receive, send)
        headers = scope.get('headers', [])
        hosts = [v for k, v in headers if k.lower() == b'host']
        origins = [v for k, v in headers if k.lower() == b'origin']
        write = scope.get('method') not in {'GET', 'HEAD', 'OPTIONS'}
        valid = hosts == [self.host] and (origins == [self.origin.encode()] if write or origins else True)
        if not valid:
            if scope['type'] == 'websocket': return await send({'type': 'websocket.close', 'code': 1008})
            return await JSONResponse({'code': 'local_origin_forbidden', 'message': '请使用启动器打开的本机地址', 'retryable': False}, status_code=403)(scope, receive, send)
        await self.app(scope, receive, send)


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
