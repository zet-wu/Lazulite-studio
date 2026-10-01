import { useEffect, useRef, useState } from 'react';
import { createRecoveryAdapter } from '../../adapters/recovery';
import { exportLyricFile, type LyricFormat } from '../../adapters/lyric-formats';
import { createLyricEditorState, executeLyricCommand, redoLyricCommand, undoLyricCommand, type LyricCommand } from '../../domain/lyric-commands';
import { createLyricDocument, type LyricDocument } from '../../domain/lyric-document';
import { EditorWorkspace } from './EditorWorkspace';

function download(xml: string, name: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: name.endsWith('.ttml') ? 'application/ttml+xml' : 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LocalEditor() {
  const [state, setState] = useState(() => createLyricEditorState(createLyricDocument()));
  const stateRef = useRef(state);
  const commitState = (next: typeof state) => { stateRef.current = next; setState(next); };
  const [clean, setClean] = useState<LyricDocument>(state.present);
  const [name, setName] = useState('未命名.ttml');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);
  const dirty = state.present !== clean;
  useEffect(() => {
    let active = true;
    void createRecoveryAdapter().readCheckpoint('local').then((record) => {
      if (!active || !record || touched.current) return;
      if (window.confirm('发现本地检查点，是否恢复？')) {
        commitState(record.state);
        setClean(record.state.present);
        setName('恢复的草稿.ttml');
      }
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : '读取本地检查点失败'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const apply = (command: LyricCommand) => {
    const next = executeLyricCommand(stateRef.current, command);
    touched.current = true; commitState(next);
  };
  const save = async () => {
    try {
      setSaving(true);
      await createRecoveryAdapter().save('local', 'local', state);
      setClean(state.present);
      setMessage('检查点已保存');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存检查点失败'); }
    finally { setSaving(false); }
  };
  const exportFormat = (format: LyricFormat) => {
    download(exportLyricFile(state.present, format), name.replace(/\.[^.]*$/, '') + '.' + (format === 'elrc' ? 'extended.lrc' : format));
  };
  const createNew = async () => {
    if (dirty && !window.confirm('当前修改尚未保存，确定新建吗？')) return;
    try {
      await createRecoveryAdapter().clear('local');
      const next = createLyricDocument();
      touched.current = true; commitState(createLyricEditorState(next)); setClean(next); setName('未命名.ttml'); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '新建失败'); }
  };
  return <EditorWorkspace title={name} document={state.present} apply={apply} undo={() => commitState(undoLyricCommand(stateRef.current))} redo={() => commitState(redoLyricCommand(stateRef.current))}
    canUndo={state.past.length > 0} canRedo={state.future.length > 0} dirty={dirty} saving={saving} error={message}
    onSave={() => void save()} onImportName={setName} onNew={() => void createNew()}
    onExportFormat={exportFormat} />;
}
