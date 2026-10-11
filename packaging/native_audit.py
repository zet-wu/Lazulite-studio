"""Audit native dependency names/architectures; no claim of minimum-OS validation."""
import os
import re
from pathlib import Path
import subprocess


def audit(root, target):
    root = Path(root).resolve()
    report = []
    minimum_versions = []
    if target.startswith('windows'):
        import pefile  # Build-only dependency; never installed into the distribution.
        files = [p for p in root.rglob('*') if p.suffix.lower() in ('.exe', '.dll', '.pyd')]
        bundled = {p.name.lower() for p in files}
        system = Path(os.environ['SystemRoot']) / 'System32'
        for path in files:
            pe = pefile.PE(str(path), fast_load=True)
            try:
                if pe.FILE_HEADER.Machine != 0x8664:
                    raise ValueError(f'非 x64 PE：{path}')
                pe.parse_data_directories(directories=[1, 13])
                imports = [entry.dll.decode().lower() for attr in ('DIRECTORY_ENTRY_IMPORT', 'DIRECTORY_ENTRY_DELAY_IMPORT')
                           for entry in getattr(pe, attr, [])]
                missing = []
                for name in imports:
                    if name in bundled or name.startswith(('api-ms-win-', 'ext-ms-win-')):
                        continue
                    if name in ('nvcuda.dll', 'nvml.dll') and target.endswith('cuda'):
                        continue  # Driver-provided; CUDA hardware validation remains separate.
                    if name.startswith(('vcruntime', 'msvcp', 'concrt')) or not (system / name).is_file():
                        missing.append(name)
                if missing:
                    raise ValueError(f'未闭合 DLL：{path.relative_to(root)}: {missing}')
                report.append({'file':path.relative_to(root).as_posix(), 'imports':imports})
            finally:
                pe.close()
    else:
        bundled = {p.name for p in root.rglob('*') if p.is_file()}
        for path in root.rglob('*'):
            if not path.is_file() or path.is_symlink():
                continue
            with path.open('rb') as stream:
                magic = stream.read(4)
            if magic not in (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'):
                continue
            arch = subprocess.check_output(['lipo', '-archs', str(path)], text=True).strip()
            if 'arm64' not in arch.split():
                raise ValueError(f'非 arm64 Mach-O：{path}')
            dependencies = subprocess.check_output(['otool', '-arch', 'arm64', '-L', str(path)], text=True)
            commands = subprocess.check_output(['otool', '-arch', 'arm64', '-l', str(path)], text=True)
            for line in dependencies.splitlines()[1:]:
                name = line.strip().split(' (', 1)[0]
                if name.startswith('/') and not name.startswith(('/usr/lib/', '/System/Library/')):
                    raise ValueError(f'包外动态依赖：{path}: {name}')
                if name.startswith('@') and Path(name).name not in bundled:
                    raise ValueError(f'包内动态依赖缺失：{path}: {name}')
            for value in re.findall(r'(?:minos|version)\s+(\d+\.\d+(?:\.\d+)?)', '\n'.join(block for block in commands.split('Load command') if 'LC_BUILD_VERSION' in block or 'LC_VERSION_MIN_MACOSX' in block)):
                minimum_versions.append(tuple(map(int, value.split('.'))))
            if '/opt/homebrew' in commands or '/Users/runner' in commands:
                # Debug strings are not included in otool load commands.
                raise ValueError(f'构建机路径出现在 Mach-O load commands：{path}')
            report.append({'file':path.relative_to(root).as_posix(), 'arch':arch,
                           'dependencies':dependencies, 'load_commands':commands})
    return {'target':target, 'binaries':report,
            'declared_macos_minimum':'.'.join(map(str, max(minimum_versions))) if minimum_versions else None,
            'scope':'static imports and architecture; actual loader verified by relocated smoke; minimum OS/GPU unverified'}
