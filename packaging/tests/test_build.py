from pathlib import Path
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
    assert all(not (site / name).exists() for name in removed)
    assert all((site / name).is_file() for name in retained)
    assert build.remove_foreign_installer_templates(tmp_path) == []


def test_windows_runtime_is_deployed_beside_nested_tools(tmp_path):
    runtime = tmp_path / 'runtime/python'
    scripts = runtime / 'Scripts'
    scripts.mkdir(parents=True)
    names = ('msvcp140.dll', 'msvcp140_2.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll')
    for name in names + ('unrelated.dll',):
        (scripts / name).write_bytes(name.encode())
    for name in ('python.exe', 'Scripts/pip.exe', 'Lib/site-packages/opencc/clib/bin/opencc.exe',
                 'Lib/site-packages/another/tool.exe'):
        path = runtime / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture')
    report = build.deploy_windows_runtime(tmp_path)
    assert len(report) == 2 * len(names)
    for directory in ('opencc/clib/bin', 'another'):
        folder = runtime / 'Lib/site-packages' / directory
        for name in names:
            assert (folder / name).read_bytes() == name.encode()
        assert not (folder / 'unrelated.dll').exists()
    conflict = runtime / 'Lib/site-packages/another/msvcp140.dll'
    conflict.write_bytes(b'different version')
    with pytest.raises(ValueError, match='冲突'):
        build.deploy_windows_runtime(tmp_path)
    (scripts / 'msvcp140.dll').unlink()
    with pytest.raises(ValueError, match='缺少'):
        build.deploy_windows_runtime(tmp_path)


def test_failed_build_does_not_leave_publishable_archives(tmp_path, monkeypatch):
    output = tmp_path / 'build'
    def fail(target, output, model_release_tag, model_repository):
        artifacts = output / 'artifacts'
        artifacts.mkdir()
        (artifacts / 'unverified.7z.001').write_bytes(b'not verified')
        (artifacts / 'unverified.7z.002').write_bytes(b'not verified')
        raise RuntimeError('simulated assembly failure')
    monkeypatch.setattr(build, 'build', fail)
    monkeypatch.setattr(sys, 'argv', ['build.py', '--target', 'windows-x64-cpu', '--output', str(output), '--model-release-tag', 'v1'])
    with pytest.raises(SystemExit) as error:
        build.main()
    assert error.value.code == 1
    assert not list((output / 'artifacts').iterdir())
    assert 'simulated assembly failure' in (output / 'build.log').read_text()


def test_build_rejects_wrong_native_platform_before_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(build.platform, 'system', lambda: 'Linux')
    with pytest.raises(RuntimeError, match='原生架构'):
        build.build('windows-x64-cpu', tmp_path, 'v1', 'owner/repo')
    assert list(tmp_path.iterdir()) == []


def test_assembled_downloaders_run_isolated_with_non_ascii_path(tmp_path):
    import json
    import subprocess
    import zipfile
    root = tmp_path / '程序 with spaces'; root.mkdir()
    build.model_downloads(root, 'v1.2.3', 'owner/repo')
    config_path = root / 'model-downloads.json'
    config = json.loads(config_path.read_text())
    assert config['vocal_models']['bs-karaoke'] == 'https://github.com/owner/repo/releases/download/v1.2.3/bs-karaoke.zip'
    assert not (root / 'vocal-models/bs-karaoke').exists()
    def run(category, answer):
        return subprocess.run([sys.executable, '-I', '-X', 'utf8', str(root / f'download_{category}_models.py')],
                              input=answer, text=True, capture_output=True, cwd=tmp_path)
    assert run('align', '0\n').returncode == 0
    assert run('vocal', 'N\n').returncode == 0
    archive = tmp_path / 'bs.zip'
    with zipfile.ZipFile(archive, 'w') as stream:
        for name in ('bs_roformer_karaoke_frazer_becruily.ckpt', 'config_karaoke_frazer_becruily.yaml'):
            stream.writestr('bs-karaoke/' + name, b'fixture')
    config['vocal_models']['bs-karaoke'] = archive.as_uri()
    config_path.write_text(json.dumps(config))
    result = run('vocal', 'y\n')
    assert result.returncode == 0, result.stdout + result.stderr
    assert '安装完成' in result.stdout
    assert (root / 'vocal-models/bs-karaoke/bs_roformer_karaoke_frazer_becruily.ckpt').is_file()
    # A different package using a missing URL must expose a failing exit status.
    for file in (root / 'vocal-models/bs-karaoke').iterdir():
        file.unlink()
    archive.unlink()
    assert run('vocal', 'Y\n').returncode == 1
