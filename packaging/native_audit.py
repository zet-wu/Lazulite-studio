"""Remove unused host search paths from bundled macOS Mach-O binaries."""
import re
from pathlib import Path
import subprocess


def macho_dependencies(commands):
    # Unlike otool -L, load commands distinguish a dylib's own install name
    # (LC_ID_DYLIB) from the libraries it loads. Check every dependency kind.
    kinds = {'LC_LOAD_DYLIB', 'LC_LOAD_WEAK_DYLIB', 'LC_REEXPORT_DYLIB',
             'LC_LAZY_LOAD_DYLIB', 'LC_LOAD_UPWARD_DYLIB'}
    dependencies = []
    blocks = re.split(r'(?m)^Load command \d+\s*$', commands)
    if len(blocks) == 1:
        raise ValueError('无法解析 Mach-O load commands')
    for block in blocks[1:]:
        kind = re.search(r'(?m)^\s*cmd\s+(\S+)\s*$', block)
        if not kind:
            raise ValueError(f'无法解析 Mach-O load command：{block}')
        if kind[1] in kinds:
            name = re.search(r'(?m)^\s*name (.+) \(offset \d+\)\s*$', block)
            if not name:
                raise ValueError(f'无法解析 Mach-O 依赖：{block}')
            dependencies.append(name[1])
    return dependencies


def remove_unused_host_rpaths(root):
    """Remove stale wheel build search paths only from binaries without @rpath imports.

    Direct external dependencies remain errors. Never redirect them to arbitrary
    same-named libraries. Re-sign modified Mach-O files after stripping rpaths.
    """
    changes = []
    for path in sorted(Path(root).rglob('*')):
        if not path.is_file() or path.is_symlink() or path.suffix not in ('.so', '.dylib'):
            continue
        commands = subprocess.check_output(['otool', '-arch', 'arm64', '-l', str(path)], text=True)
        host_paths = []
        for block in re.split(r'(?m)^Load command \d+\s*$', commands)[1:]:
            if not re.search(r'(?m)^\s*cmd\s+LC_RPATH\s*$', block):
                continue
            match = re.search(r'(?m)^\s*path (.+) \(offset \d+\)\s*$', block)
            if not match:
                raise ValueError(f'无法解析 Mach-O RPATH：{path}')
            if match[1].startswith(('/opt/homebrew/', '/Users/runner/')):
                host_paths.append(match[1])
        if not host_paths:
            continue
        imports = macho_dependencies(commands)
        if any(name.startswith('@rpath/') for name in imports):
            raise ValueError(f'存在 @rpath 依赖，不能自动删除构建机搜索路径：{path}')
        for name in dict.fromkeys(host_paths):
            subprocess.run(['install_name_tool', '-delete_rpath', name, str(path)], check=True)
        subprocess.run(['codesign', '--force', '--sign', '-', str(path)], check=True)
        subprocess.run(['codesign', '--verify', '--strict', str(path)], check=True)
        changes.append({'file':path.relative_to(root).as_posix(), 'removed_rpaths':host_paths})
    return changes
