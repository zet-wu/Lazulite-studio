"""Persistent vocal products; cancellation is honoured between real model stages."""
from __future__ import annotations
import hashlib
import json
import os
import inspect
from importlib.metadata import version, PackageNotFoundError
import shutil
from dataclasses import asdict
from pathlib import Path
import numpy as np
from .engine import EngineUnavailable
from .time_units import milliseconds

class VocalCancelled(Exception): pass

class VocalRunner:
    def __init__(self, db, root: Path, separator_factory=None, *, cleanup=True):
        self.db, self.root = db, root
        self.root.mkdir(parents=True, exist_ok=True)
        self.separator_factory = separator_factory
        self._audio_checks = {}
        from .vocal_process import VocalProcess
        self._worker = VocalProcess()
        if not cleanup: return
        # Startup has no live model worker. Discard only unregistered partial products.
        with db.connect() as c:
            known = {Path(row[0]).resolve() for row in c.execute('SELECT directory FROM vocal_results')}
        for directory in self.root.glob('*/vocals/*'):
            if directory.is_dir() and directory.resolve() not in known: shutil.rmtree(directory)

    def close(self):
        self._worker.close()

    def run(self, project_id, asset_path, params, job_id, emit, cancelled):
        # Injected lightweight separators remain in-process for deterministic domain tests.
        if self.separator_factory:
            return self.run_in_process(project_id, asset_path, params, job_id, emit, cancelled)
        return self._worker.run({'database': str(Path(self.db.path).resolve()), 'root': str(self.root.resolve()),
            'project_id': project_id, 'asset_path': str(Path(asset_path).resolve()), 'params': params, 'job_id': job_id}, emit, cancelled)

    def run_in_process(self, project_id, asset_path, params, job_id, emit, cancelled):
        try:
            import soundfile as sf
        except ImportError as exc:
            raise EngineUnavailable('缺少人声依赖，请安装 requirements-vocal.txt') from exc
        from lazulite.audio.io import decode_audio
        from lazulite.audio.activity import analyze_vocals, build_activity_profile, VocalConfig
        import scipy
        from lazulite.models.audio import AudioBuffer
        def boundary():
            if cancelled(): raise VocalCancelled()
        boundary()
        result_id = job_id
        directory = self.root / project_id / 'vocals' / result_id
        directory.mkdir(parents=True, exist_ok=True)
        vocal_path = directory / 'vocals.wav'
        signature = self.separation_signature(params['asset_id'], params['model_name'], params['device'])
        reuse = None
        if params.get('retry_analysis_id'):
            row, candidate = self.get(project_id, params['retry_analysis_id'])
            if row['source_asset_id'] != params['asset_id']: raise ValueError('人声来源不匹配')
            if candidate['separation_signature'] == signature and self.audio_available(project_id, candidate): reuse = (row, candidate)
        else:
            with self.db.connect() as c:
                rows = c.execute('SELECT * FROM vocal_results WHERE project_id=? AND source_asset_id=? ORDER BY rowid DESC', (project_id, params['asset_id'])).fetchall()
            for row in rows:
                candidate = json.loads(row['metadata_json'])
                if candidate['separation_signature'] == signature and self.audio_available(project_id, candidate):
                    reuse = (row, candidate)
                    break
        if reuse:
            row, metadata = reuse
            if not params.get('retry_analysis_id') and row['status'] == 'ready':
                boundary()
                return self.result(project_id, metadata)
            vocal_path = self.audio_path(project_id, metadata)
            audio_id = metadata['audio_result_id']
            for key in ('segments', 'diagnostics', 'analysis_config', 'energy_hop_ms'):
                metadata.pop(key, None)
            metadata.update(id=result_id, audio_result_id=audio_id)
            with self.db.transaction() as c:
                c.execute('INSERT INTO vocal_results VALUES(?,?,?,?,?,?)', (result_id, project_id, params['asset_id'], 'separated', str(directory), json.dumps(metadata)))
        else:
            emit('stage', 'separating', None, None, '正在分离人声；取消将在阶段结束后生效')
            try:
                from lazulite.audio.separation import DemucsSeparator, DemucsConfig
                separator = self.separator_factory() if self.separator_factory else DemucsSeparator(DemucsConfig(model_name=params['model_name'], device=params['device']))
                audio = decode_audio(asset_path, sample_rate=44100, channels=2)
                vocals = separator.separate(audio)
                # The actual loaded weights, not an unverified caller-supplied label.
                if hasattr(separator, '_model'):
                    digest = hashlib.sha256()
                    for key, tensor in sorted(separator._model.state_dict().items()):
                        digest.update(key.encode()); digest.update(tensor.detach().cpu().numpy().tobytes())
                    identity = {'model': params['model_name'], 'weights_sha256': digest.hexdigest(), 'config': asdict(separator.config)}
                else: identity = separator.cache_identity
            except (ImportError, RuntimeError) as exc:
                raise EngineUnavailable(f'人声分离不可用：{exc}') from exc
            finally:
                if 'separator' in locals(): separator.close()
            if not np.isfinite(vocals.samples).all(): raise ValueError('分离人声包含非有限样本')
            peak = float(np.max(np.abs(vocals.samples), initial=0))
            gain = min(1.0, (1 - 2 ** -15) / peak) if peak else 1.0
            # Multiply in float64 so rounding cannot push the positive peak to 1.
            sf.write(str(vocal_path), vocals.samples.T.astype(np.float64) * gain, vocals.sample_rate, format='WAV', subtype='PCM_16')
            metadata = {'id': result_id, 'source_asset_id': params['asset_id'], 'model': identity,
                        'gain': gain, 'peak_before_gain': peak, 'sample_rate': vocals.sample_rate,
                        'channels': vocals.samples.shape[0], 'frames': vocals.samples.shape[1],
                        'duration_ms': milliseconds(vocals.duration), 'format': 'WAV PCM_16',
                        'quantization': 'float to signed 16-bit PCM', 'analysis_version': 'lazulite-vocal-core-v2-main-rms', 'analysis_source_sha256': hashlib.sha256(Path(__import__('inspect').getfile(analyze_vocals)).read_bytes()).hexdigest(), 'runtime': {'numpy': np.__version__, 'soundfile': sf.__version__}}
            metadata.update(audio_result_id=result_id, separation_signature=signature, audio_sha256=self.file_hash(vocal_path))
            with self.db.transaction() as c:
                c.execute('INSERT INTO vocal_results VALUES(?,?,?,?,?,?)', (result_id, project_id, params['asset_id'], 'separated', str(directory), json.dumps(metadata)))
            del audio, vocals
        boundary()
        emit('stage', 'analyzing', None, None, '正在分析持久人声的能量与核心片段')
        samples, rate = sf.read(str(vocal_path), dtype='float32', always_2d=True)
        audio = AudioBuffer(samples.T, rate, params['asset_id'])
        metadata.update(analysis_source_sha256=hashlib.sha256(Path(__import__('inspect').getfile(analyze_vocals)).read_bytes()).hexdigest(), analysis_version='lazulite-vocal-core-v2-main-rms', runtime={'numpy': np.__version__, 'soundfile': sf.__version__, 'scipy': scipy.__version__})
        config = VocalConfig()
        analysis = analyze_vocals(audio, config=config)
        # Public Lazulite profile: centered frames of its main-vocal signal.
        # main_rms has no temporal smoothing; activity/split_activity are different
        # normalized, smoothed curves and are not the Studio energy display.
        profile = build_activity_profile(audio, config=config)
        np.save(directory / 'energy.npy', profile['main_rms'].astype(np.float32), allow_pickle=False)
        del profile
        metadata.update({'segments': [{'id': s.id, 'beginMs': milliseconds(s.core_start), 'endMs': milliseconds(s.core_end)} for s in analysis.segments],
                         'diagnostics': list(analysis.diagnostics), 'analysis_config': asdict(config), 'energy_hop_ms': config.hop_length * 1000 / rate})
        boundary()
        (directory / 'analysis.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        with self.db.transaction() as c:
            c.execute("UPDATE vocal_results SET status='ready',metadata_json=? WHERE id=?", (json.dumps(metadata, ensure_ascii=False), result_id))
        return self.result(project_id, metadata)

    @staticmethod
    def result(project_id, metadata):
        return {'kind': 'vocal', 'analysis_id': metadata['id'], 'binding': {'project_id': project_id, 'asset_id': metadata['source_asset_id']}, 'engine': metadata['model']}

    @staticmethod
    def file_hash(path):
        with Path(path).open('rb') as source:
            return hashlib.file_digest(source, 'sha256').hexdigest()

    def separation_signature(self, asset_id, model_name=None, device=None):
        from lazulite.audio import io, separation
        from lazulite.audio.separation import DemucsConfig
        config = asdict(DemucsConfig(model_name=model_name or os.getenv('STUDIO_VOCAL_MODEL', 'htdemucs'), device=device or os.getenv('STUDIO_VOCAL_DEVICE', 'cpu')))
        with self.db.connect() as c:
            source_hash = c.execute('SELECT sha256 FROM assets WHERE id=?', (asset_id,)).fetchone()[0]
        # The fixed model catalogue is versioned with Demucs. Record loaded weight
        # hashes separately for provenance; analysis source changes do not invalidate audio.
        identity = {'source': source_hash, 'config': config, 'pcm_pipeline': 'demucs-44100-stereo-f32-wav-pcm16-v2',
                    'implementation': [self.file_hash(inspect.getfile(module)) for module in (io, separation)]}
        if self.separator_factory:
            separator = self.separator_factory()
            try: identity['separator'] = separator.cache_identity
            finally: separator.close()
        else:
            identity['runtime'] = {}
            for name in ('demucs', 'torch', 'soundfile'):
                try: identity['runtime'][name] = version(name)
                except PackageNotFoundError: identity['runtime'][name] = None
        return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()

    def audio_path(self, project_id, metadata):
        owner, _ = self.get(project_id, metadata['audio_result_id'])
        return Path(owner['directory']) / 'vocals.wav'

    def audio_available(self, project_id, metadata):
        import soundfile as sf
        if metadata['format'] != 'WAV PCM_16': return False
        path = self.audio_path(project_id, metadata)
        try:
            stat = path.stat()
            stamp = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, metadata['audio_sha256'])
            cached = self._audio_checks.get(path)
            if cached and cached[0] == stamp: return cached[1]
            info = sf.info(path)
            valid = (info.format == 'WAV' and info.subtype == 'PCM_16' and info.frames == metadata['frames'] and info.samplerate == metadata['sample_rate'] and info.channels == metadata['channels'])
            if valid:
                valid = self.file_hash(path) == metadata['audio_sha256']
        except (OSError, sf.LibsndfileError):
            return False
        self._audio_checks[path] = (stamp, valid)
        return valid


    def get(self, project_id, result_id):
        with self.db.connect() as c:
            row = c.execute('SELECT * FROM vocal_results WHERE id=? AND project_id=?', (result_id, project_id)).fetchone()
        if not row: raise KeyError(result_id)
        return row, json.loads(row['metadata_json'])

    def clean_unregistered(self, project_id, result_id):
        with self.db.connect() as c:
            found = c.execute('SELECT 1 FROM vocal_results WHERE id=?', (result_id,)).fetchone()
        directory = self.root / project_id / 'vocals' / result_id
        if not found and directory.is_dir(): shutil.rmtree(directory)
