import { ProjectEditingContext } from './ProjectEditingContext';
import { useEffect, useRef, useState } from 'react';
import { createRecoveryAdapter } from '../../adapters/recovery';
import { exportLyricFile, type LyricFormat } from '../../adapters/lyric-formats';
import type { LyricCommand } from '../../domain/lyric-commands';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, redoProjectCommand, undoProjectCommand, type ProjectDocument } from '../../domain/project-document';
import { createLyricDocument } from '../../domain/lyric-document';
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
  const [state, setState] = useState(() => createProjectEditorState(createProjectDocument()));
  const stateRef = useRef(state);
  const commitState = (next: typeof state) => { stateRef.current = next; setState(next); };
  const [clean, setClean] = useState<ProjectDocument>(state.present);
  const [name, setName] = useState('未命名.ttml');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
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
    const next = executeProjectCommand(stateRef.current, { type: 'lyrics', command });
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
    download(exportLyricFile(state.present.lyrics, format, state.present.editing), name.replace(/\.[^.]*$/, '') + '.' + (format === 'elrc' ? 'extended.lrc' : format));
  };
  const createNew = async () => {
    if (dirty && !window.confirm('当前修改尚未保存，确定新建吗？')) return;
    try {
      await createRecoveryAdapter().clear('local');
      const next = createProjectDocument(createLyricDocument());
      touched.current = true; commitState(createProjectEditorState(next)); setClean(next); setName('未命名.ttml'); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '新建失败'); }
  };
  return <ProjectEditingContext value={state.present.editing}><EditorWorkspace historyVersion={historyVersion} project={state.present} title={name} document={state.present.lyrics} apply={apply} undo={() => { commitState(undoProjectCommand(stateRef.current)); setHistoryVersion(v => v + 1); }} redo={() => { commitState(redoProjectCommand(stateRef.current)); setHistoryVersion(v => v + 1); }}
    canUndo={state.past.length > 0} canRedo={state.future.length > 0} dirty={dirty} saving={saving} error={message}
    onSave={() => void save()} onImportName={setName} onNew={() => void createNew()}
    onExportFormat={exportFormat} /></ProjectEditingContext>;
}
