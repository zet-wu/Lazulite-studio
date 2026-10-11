from pathlib import Path
import json
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build


def test_remove_only_foreign_installer_templates(tmp_path):
    site = tmp_path / 'runtime/python/Lib/site-packages'
    removed = ['setuptools/' + name for name in (
        'cli.exe', 'gui.exe', 'cli-32.exe', 'gui-32.exe', 'cli-arm64.exe', 'gui-arm64.exe')]
    removed += ['pip/_vendor/distlib/' + name for name in ('t32.exe', 'w32.exe', 't64-arm.exe', 'w64-arm.exe')]
    retained = ['setuptools/cli-64.exe', 'setuptools/gui-64.exe',
                'pip/_vendor/distlib/t64.exe', 'pip/_vendor/distlib/w64.exe',
                'other/cli-32.exe', 'setuptools/unexpected.exe', 'setuptools/__init__.py']
    for name in removed + retained:
        path = site / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture')
    report = build.remove_foreign_installer_templates(tmp_path)
    assert {item['path'] for item in report} == {
        'runtime/python/Lib/site-packages/' + name for name in removed}
    assert all(len(item['sha256']) == 64 for item in report)
    assert all(not (site / name).exists() for name in removed)
    assert all((site / name).is_file() for name in retained)
    assert build.remove_foreign_installer_templates(tmp_path) == []


def test_failed_smoke_does_not_leave_publishable_archives(tmp_path, monkeypatch):
    output = tmp_path / 'build'
    def fail(target, output):
        artifacts = output / 'artifacts'
        artifacts.mkdir()
        (artifacts / 'unverified.zip').write_bytes(b'not verified')
        raise RuntimeError('simulated smoke failure')
    monkeypatch.setattr(build, 'build', fail)
    monkeypatch.setattr(sys, 'argv', ['build.py', '--target', 'windows-x64-cpu', '--output', str(output)])
    with pytest.raises(SystemExit) as error:
        build.main()
    assert error.value.code == 1
    assert not list((output / 'artifacts').glob('*.zip'))
    assert 'simulated smoke failure' in (output / 'build.log').read_text()


def test_build_rejects_wrong_native_platform_before_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(build.platform, 'system', lambda: 'Linux')
    with pytest.raises(RuntimeError, match='原生架构'):
        build.build('windows-x64-cpu', tmp_path)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize('target,system,arch', [
    ('windows-x64-cpu', 'Windows', 'AMD64'),
    ('windows-x64-cuda', 'Windows', 'AMD64'),
    ('macos-arm64', 'Darwin', 'arm64'),
])
def test_build_host_uses_its_own_version_pin(monkeypatch, target, system, arch):
    runtime = {'build_python_version':'3.12.10', 'python_version':'3.12.15'}
    monkeypatch.setattr(build.platform, 'system', lambda: system)
    monkeypatch.setattr(build.platform, 'machine', lambda: arch)
    monkeypatch.setattr(build.platform, 'python_version', lambda: '3.12.10')
    build.check_build_host(target, runtime)
    monkeypatch.setattr(build.platform, 'python_version', lambda: '3.13.0')
    with pytest.raises(RuntimeError, match='构建 Python 3.12.10'):
        build.check_build_host(target, runtime)


@pytest.mark.parametrize('explicit_directories', [True, False])
def test_wheel_license_collection_preserves_nested_files(tmp_path, monkeypatch, explicit_directories):
    import zipfile
    source = tmp_path / 'source'
    (source / 'server/vendor').mkdir(parents=True)
    (source / 'vendor/Lazulite').mkdir(parents=True)
    for name in ('LICENSE', 'THIRD_PARTY_LICENSES'):
        (source / 'vendor/Lazulite' / name).write_text(name)
    frontend = source / 'frontend-dependency'
    frontend.mkdir()
    (frontend / 'package.json').write_text('{}')
    (frontend / 'LICENSE').write_text('frontend license')
    monkeypatch.setattr(build, 'ROOT', source)
    monkeypatch.setattr(build.subprocess, 'check_output', lambda *a, **k: json.dumps([
        {'path':str(frontend), 'version':'1.0'}]))
    dependencies = tmp_path / 'dependencies'
    (dependencies / 'wheelhouse').mkdir(parents=True)
    wheel = dependencies / 'wheelhouse/fixture-1.0-py3-none-any.whl'
    files = {
        'fixture-1.0.dist-info/METADATA': b'Name: fixture\nVersion: 1.0\n',
        'fixture-1.0.dist-info/licenses/LICENSE': b'main license',
        'fixture-1.0.dist-info/licenses/vendor/COPYING': b'nested license',
    }
    with zipfile.ZipFile(wheel, 'w') as archive:
        if explicit_directories:
            archive.writestr('fixture-1.0.dist-info/licenses/', b'')
            archive.writestr('fixture-1.0.dist-info/licenses/vendor/', b'')
        for name, content in files.items():
            archive.writestr(name, content)
        archive.writestr('fixture-1.0.dist-info/RECORD', b'not a license')
    root = tmp_path / 'distribution'
    root.mkdir()
    build.licenses(root, dependencies, 'pnpm')
    destination = root / 'licenses/python' / wheel.stem
    assert (destination / 'fixture-1.0.dist-info/licenses').is_dir()
    for name, content in files.items():
        assert (destination / name).read_bytes() == content
    assert not (destination / 'fixture-1.0.dist-info/RECORD').exists()
