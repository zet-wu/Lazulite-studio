"""Range downloads opened under the project commit lock, then streamed by handle."""
import os
import re
from fastapi.responses import Response, StreamingResponse


def stream_file(path, media_type, range_header=None, if_range=None):
    handle = path.open('rb')
    stat = os.fstat(handle.fileno())
    size = stat.st_size
    etag = f'"{stat.st_mtime_ns:x}-{size:x}"'
    if if_range and if_range != etag: range_header = None
    first, last, status = 0, size - 1, 200
    if range_header:
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header)
        if not match or not any(match.groups()):
            handle.close()
            return Response(status_code=416, headers={'Content-Range': f'bytes */{size}'})
        start, end = match.groups()
        first = int(start) if start else max(0, size - int(end))
        last = min(size - 1, int(end)) if start and end else size - 1
        if first > last or first >= size:
            handle.close()
            return Response(status_code=416, headers={'Content-Range': f'bytes */{size}'})
        status = 206
    headers = {'ETag':etag, 'Accept-Ranges':'bytes', 'Content-Length':str(last-first+1)}
    if status == 206: headers['Content-Range'] = f'bytes {first}-{last}/{size}'
    def chunks():
        remaining = last-first+1
        try:
            handle.seek(first)
            while remaining:
                block = handle.read(min(256*1024,remaining))
                if not block: break
                remaining -= len(block)
                yield block
        finally: handle.close()
    return StreamingResponse(chunks(), status_code=status, headers=headers, media_type=media_type)


def stream_memory(proxy, etag, range_header=None, if_range=None, release=lambda: None):
    """Range response over one shared PCM resource, held through disconnection."""
    class OwnedResponse(StreamingResponse):
        async def __call__(self, scope, receive, send):
            try: await super().__call__(scope, receive, send)
            finally: release()
    size = proxy.size
    if if_range and if_range != etag: range_header = None
    first, last, status = 0, size - 1, 200
    if range_header:
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header)
        if not match or not any(match.groups()):
            release()
            return Response(status_code=416, headers={'Content-Range': f'bytes */{size}'})
        start, end = match.groups()
        first = int(start) if start else max(0, size - int(end))
        last = min(size - 1, int(end)) if start and end else size - 1
        if first > last or first >= size:
            release()
            return Response(status_code=416, headers={'Content-Range': f'bytes */{size}'})
        status = 206
    headers = {'ETag': etag, 'Accept-Ranges': 'bytes', 'Content-Length': str(last-first+1)}
    if status == 206: headers['Content-Range'] = f'bytes {first}-{last}/{size}'
    def chunks():
        try:
            for offset in range(first, last + 1, 256 * 1024):
                yield proxy.read(offset, min(last + 1, offset + 256 * 1024))
        finally: release()
    return OwnedResponse(chunks(), status_code=status, headers=headers, media_type=proxy.mime_type)
