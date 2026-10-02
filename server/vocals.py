"""Persistent vocal products; cancellation is honoured between real model stages."""
from __future__ import annotations
import hashlib
import json
import os
import shutil
from dataclasses import asdict
from pathlib import Path
import numpy as np
from .engine import EngineUnavailable
from .time_units import milliseconds

class VocalCancelled(Exception): pass

class VocalRunner:
    def __init__(self, db, root: Path, separator_factory=None):
        self.db, self.root = db, root
        self.root.mkdir(parents=True, exist_ok=True)
        self.separator_factory = separator_factory
        # Startup has no live model worker. Discard only unregistered partial products.
        with db.connect() as c:
            known = {Path(row[0]).resolve() for row in c.execute('SELECT directory FROM vocal_results')}
        for directory in self.root.glob('*/*'):
            if directory.is_dir() and directory.resolve() not in known: shutil.rmtree(directory)

    def run(self, project_id, asset_path, params, job_id, emit, cancelled):
        try:
            import soundfile as sf
        except ImportError as exc:
            raise EngineUnavailable('缺少人声依赖，请安装 requirements-vocal.txt') from exc
        from lazulite.audio.io import decode_audio
        from lazulite.audio.activity import analyze_vocals, VocalConfig
        from lazulite.models.audio import AudioBuffer
        def boundary():
            if cancelled(): raise VocalCancelled()
        boundary()
        result_id = job_id
        directory = self.root / project_id / result_id
        directory.mkdir(parents=True, exist_ok=True)
        vocal_path = directory / 'vocals.flac'
        if params.get('retry_analysis_id'):
            with self.db.connect() as c:
                row = c.execute('SELECT metadata_json,directory FROM vocal_results WHERE id=? AND project_id=? AND source_asset_id=?', (params['retry_analysis_id'], project_id, params['asset_id'])).fetchone()
            if not row: raise ValueError('可重用人声不存在')
            shutil.copyfile(Path(row[1]) / 'vocals.flac', vocal_path)
            metadata = json.loads(row[0])
            for key in ('segments', 'diagnostics', 'analysis_config', 'energy_hop_ms'):
                metadata.pop(key, None)
            metadata.update(id=result_id, reused_from=params['retry_analysis_id'])
            with self.db.transaction() as c:
                c.execute('INSERT INTO vocal_results VALUES(?,?,?,?,?,?)', (result_id, project_id, params['asset_id'], 'separated', str(directory), json.dumps(metadata)))
        else:
            emit('stage', 'separating', None, None, '正在分离人声；取消将在阶段结束后生效')
            try:
                from lazulite.audio.separation import DemucsSeparator, DemucsConfig
                separator = self.separator_factory() if self.separator_factory else DemucsSeparator(DemucsConfig(model_name=params['model_name'], device=params['device']))
                audio = decode_audio(asset_path)
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
            gain = min(1.0, (1 - 2 ** -23) / peak) if peak else 1.0
            # Multiply in float64 so rounding cannot push the positive peak to 1.
            sf.write(str(vocal_path), vocals.samples.T.astype(np.float64) * gain, vocals.sample_rate, format='FLAC', subtype='PCM_24')
            metadata = {'id': result_id, 'source_asset_id': params['asset_id'], 'model': identity,
                        'gain': gain, 'peak_before_gain': peak, 'sample_rate': vocals.sample_rate,
                        'channels': vocals.samples.shape[0], 'frames': vocals.samples.shape[1],
                        'duration_ms': milliseconds(vocals.duration), 'format': 'FLAC PCM_24',
                        'quantization': 'float to signed 24-bit PCM', 'analysis_version': 'lazulite-vocal-core-v1', 'analysis_source_sha256': hashlib.sha256(Path(__import__('inspect').getfile(analyze_vocals)).read_bytes()).hexdigest(), 'runtime': {'numpy': np.__version__, 'soundfile': sf.__version__}}
            with self.db.transaction() as c:
                c.execute('INSERT INTO vocal_results VALUES(?,?,?,?,?,?)', (result_id, project_id, params['asset_id'], 'separated', str(directory), json.dumps(metadata)))
            del audio, vocals
        boundary()
        emit('stage', 'analyzing', None, None, '正在分析持久人声的能量与核心片段')
        samples, rate = sf.read(str(vocal_path), dtype='float32', always_2d=True)
        audio = AudioBuffer(samples.T, rate, params['asset_id'])
        metadata.update(analysis_source_sha256=hashlib.sha256(Path(__import__('inspect').getfile(analyze_vocals)).read_bytes()).hexdigest(), runtime={'numpy': np.__version__, 'soundfile': sf.__version__})
        config = VocalConfig()
        analysis = analyze_vocals(audio, config=config)
        mono = samples.mean(axis=1)
        frame, hop = max(1, round(config.frame_seconds * rate)), max(1, round(config.hop_seconds * rate))
        windows = np.lib.stride_tricks.sliding_window_view(mono, frame)[::hop] if len(mono) >= frame else np.empty((0, frame), dtype=np.float32)
        rms = np.empty(len(windows), dtype=np.float32)
        for first in range(0, len(windows), 512):
            block = windows[first:first+512]
            rms[first:first+512] = np.sqrt(np.mean(block * block, axis=1))
        # Persist the same RMS basis and parameters used by Lazulite gating.
        np.save(directory / 'energy.npy', rms.astype(np.float32), allow_pickle=False)
        metadata.update({'segments': [{'id': s.id, 'beginMs': milliseconds(s.core_start), 'endMs': milliseconds(s.core_end)} for s in analysis.segments],
                         'diagnostics': list(analysis.diagnostics), 'analysis_config': asdict(config), 'energy_hop_ms': hop * 1000 / rate})
        boundary()
        (directory / 'analysis.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
        with self.db.transaction() as c:
            c.execute("UPDATE vocal_results SET status='ready',metadata_json=? WHERE id=?", (json.dumps(metadata, ensure_ascii=False), result_id))
        return {'kind': 'vocal', 'analysis_id': result_id, 'binding': {'project_id': project_id, 'asset_id': params['asset_id']}, 'engine': metadata['model']}

    def get(self, project_id, result_id):
        with self.db.connect() as c:
            row = c.execute('SELECT * FROM vocal_results WHERE id=? AND project_id=?', (result_id, project_id)).fetchone()
        if not row: raise KeyError(result_id)
        return row, json.loads(row['metadata_json'])

    def clean_unregistered(self, project_id, result_id):
        with self.db.connect() as c:
            found = c.execute('SELECT 1 FROM vocal_results WHERE id=?', (result_id,)).fetchone()
        directory = self.root / project_id / result_id
        if not found and directory.is_dir(): shutil.rmtree(directory)
