"""Read and render an actual Studio ASS download with ffprobe/FFmpeg/libass.
Usage: python tests/ass_export_probe.py INPUT.ass OUTPUT_DIRECTORY
"""
import ctypes as C
import ctypes.util
import json
from pathlib import Path
import subprocess
import sys

source, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
script = source.read_text(encoding='utf-8-sig')
commands = []
def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    commands.append(dict(args=args, code=result.returncode, stdout=result.stdout, stderr=result.stderr))
    result.check_returncode()
    return result.stdout

probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_packets', '-of', 'json', str(source)]))
assert probe['streams'][0]['codec_name'] == 'ass'
events = [line for line in script.splitlines() if line.startswith('Dialogue:')]
assert len(probe['packets']) == len(events)
for time in ['0.60', '1.10', '1.30', '1.80', '2.20', '5.80']:
    run(['ffmpeg', '-hide_banner', '-loglevel', 'info', '-f', 'lavfi', '-i', 'color=c=0x20242a:s=1920x1080:r=10:d=7', '-vf', f'ass={source}', '-ss', time, '-frames:v', '1', '-threads', '1', '-update', '1', '-y', str(output / f'render-{time}.png')])

class Image(C.Structure):
    pass
Image._fields_ = [('w', C.c_int), ('h', C.c_int), ('stride', C.c_int), ('bitmap', C.POINTER(C.c_ubyte)), ('color', C.c_uint32), ('dst_x', C.c_int), ('dst_y', C.c_int), ('next', C.POINTER(Image)), ('type', C.c_int)]
lib = C.CDLL(ctypes.util.find_library('ass'))
def bind(name, restype, *args):
    f = getattr(lib, name); f.restype = restype; f.argtypes = args; return f
init = bind('ass_library_init', C.c_void_p)
renderer_init = bind('ass_renderer_init', C.c_void_p, C.c_void_p)
frame_size = bind('ass_set_frame_size', None, C.c_void_p, C.c_int, C.c_int)
fonts = bind('ass_set_fonts', None, C.c_void_p, C.c_char_p, C.c_char_p, C.c_int, C.c_char_p, C.c_int)
read = bind('ass_read_memory', C.c_void_p, C.c_void_p, C.c_char_p, C.c_size_t, C.c_char_p)
render = bind('ass_render_frame', C.POINTER(Image), C.c_void_p, C.c_void_p, C.c_longlong, C.POINTER(C.c_int))
free = bind('ass_free_track', None, C.c_void_p)
lib_handle = init(); renderer = renderer_init(lib_handle)
frame_size(renderer, 1920, 1080); fonts(renderer, None, b'Arial', 1, None, 1)
header = script[:script.index('Dialogue:')]
def measure(event, time):
    data = (header + event + '\n').encode()
    track = read(lib_handle, data, len(data), None)
    assert track
    current = render(renderer, track, time, C.byref(C.c_int()))
    rects, colors = [], set()
    while current:
        im = current.contents
        if im.w and im.h and any(im.bitmap[i] for y in range(im.h) for i in range(y*im.stride, y*im.stride+im.w)):
            rects.append([im.dst_x, im.dst_y, im.dst_x+im.w, im.dst_y+im.h]); colors.add(f'{im.color:08x}')
        current = im.next
    free(track)
    return dict(bounds=[min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects)] if rects else None, colors=sorted(colors))

layout = [dict(name=e.split(',',9)[4], **measure(e, 2200)) for e in events]
visible = sorted((e for e in layout if e['bounds']), key=lambda e:e['bounds'][1])
for first, second in zip(visible, visible[1:]):
    assert first['bounds'][3] <= second['bounds'][1], (first, second)
for item in visible:
    x1,y1,x2,y2 = item['bounds']; assert 0 <= x1 < x2 <= 1920 and 0 <= y1 < y2 <= 1080, item
main = next(e for e in events if e.split(',',9)[3] == 'Main' and e.split(',',9)[4] == 'L1')
highlight = {str(t): measure(main,t) for t in [1100,1300,1800,2200]}
(output/'initial-measurements.json').write_text(json.dumps(dict(layout=layout,highlight=highlight),indent=2))
assert 'ffffffff' not in highlight['1100']['colors']  # libass colors store alpha last; opaque white is ffffff00.
assert 'ffffff00' not in highlight['1100']['colors']
assert 'ffffff00' in highlight['1300']['colors'] and '90909000' in highlight['1300']['colors']
assert '90909000' in highlight['1800']['colors']  # second word remains unhighlighted during the real gap.
assert '90909000' not in highlight['2200']['colors'] and 'ffffff00' in highlight['2200']['colors']
(output/'probe.json').write_text(json.dumps(dict(source=str(source),events=len(events),probe=probe,layout=layout,highlight=highlight,commands=commands),ensure_ascii=False,indent=2))
print(json.dumps(dict(events=len(events), readable=True, layout_nonoverlapping=True, karaoke_gap_correct=True)))
