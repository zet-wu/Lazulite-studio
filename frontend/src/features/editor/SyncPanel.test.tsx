import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../../domain/lyric-document';
import { createProjectDocument, createProjectEditorState, executeProjectCommand, undoProjectCommand } from '../../domain/project-document';
import { syncUnits, type SyncCursor } from '../../domain/sync-editing';
import type { TransportHandle } from '../MediaTransport';
import { SyncPanel } from './SyncPanel';
import { useSyncProgress } from './sync-progress';
import { ProjectEditingContext } from './ProjectEditingContext';
afterEach(() => { cleanup(); localStorage.clear(); });
function setup(background = false) {
  const document = createLyricDocument(); document.lines = [createLine('', 'a'), createLine('', 'b')];
  document.lines[0].words = [createWord('A', 'A'), createWord('B', 'B')]; document.lines[1].words = [createWord('C', 'C')];
  if (background) document.lines[1].backgroundOf = 'a';
  let state = createProjectEditorState(createProjectDocument(document)), timeMs = 1000;
  state.present.editing.emptyBeats.A = { kind: 'word', count: 2 };
  state.present.editing.emptyBeats.C = { kind: 'word', count: 1 };
  const transport = { current: { getPositionMs: () => timeMs, getPlaybackRate: () => 1, isPlaying: () => false, seekMs() {}, play() {}, pause() {}, audition() {} } satisfies TransportHandle };
  function Harness() {
    const [project, setProject] = useState(state.present);
    const [cursor, setCursor] = useState<SyncCursor>(syncUnits(document)[0]), [version, setVersion] = useState(0);
    const [progress, setProgress] = useSyncProgress(project.lyrics, project.editing, cursor, version, 0);
    return <ProjectEditingContext value={project.editing}><SyncPanel document={project.lyrics} cursor={cursor} transport={transport} onCursor={setCursor} progress={progress} onProgress={setProgress}
      apply={command => { try { state = executeProjectCommand(state, { type: 'lyrics', command }); setProject(state.present); return true; } catch { return false; } }} />
      <output data-testid="progress">{JSON.stringify(progress)}</output>
      <button onClick={() => { setVersion(v => v + 1); setCursor(syncUnits(project.lyrics, project.editing, background ? 'b' : undefined).at(-1)!); }}>choose last</button>
      <button onClick={() => { state = undoProjectCommand(state); setProject(state.present); setVersion(v => v + 1); }}>undo</button>
    </ProjectEditingContext>;
  }
  render(<Harness />);
  return { state: () => state, time: (ms: number) => { timeMs = ms; }, progress: () => JSON.parse(screen.getByTestId('progress').textContent!) };
}
const stamp = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));
it('requires a start before consuming post beats and follows the agreed four-step sequence', () => {
  const run = setup();
  stamp('连续轴'); expect(run.progress().consumed).toBe(0); expect(screen.getByRole('alert')).toHaveTextContent('起始轴');
  stamp('起始轴'); expect(run.state().past).toHaveLength(1);
  run.time(1250); stamp('连续轴'); expect(run.progress().consumed).toBe(1);
  run.time(1500); stamp('连续轴'); expect(run.progress().consumed).toBe(2); expect(run.state().past).toHaveLength(1);
  run.time(1750); stamp('连续轴'); expect(run.progress().consumed).toBe(0);
  expect(run.state().present.lyrics.lines[0].words.map(word => [word.beginMs, word.endMs])).toEqual([[1000, 1750], [1750, null]]);
  stamp('undo'); expect(run.progress().consumed).toBe(0); expect(run.state().past).toHaveLength(1);
});
it('failed final stamps retain count and target; restarting succeeds before resetting; end bypasses beats', () => {
  const run = setup(); stamp('起始轴'); stamp('连续轴'); stamp('连续轴');
  run.time(500); stamp('连续轴'); expect(run.progress().consumed).toBe(2); expect(run.state().past).toHaveLength(1);
  run.time(2000); stamp('起始轴'); expect(run.progress().consumed).toBe(0);
  run.time(2500); stamp('结束轴'); expect(run.state().present.lyrics.lines[0].words[1].beginMs).toBeNull();
  stamp('连续轴'); expect(screen.getByRole('alert')).toHaveTextContent('起始轴');
});
it('finishes silently at the final unit, ignores repeat end, and start reopens', () => {
  const run = setup(); stamp('choose last'); stamp('起始轴'); run.time(2000); stamp('结束轴');
  expect(run.progress().completed).toBe(true); expect(screen.queryByText('本行已完成')).toBeNull();
  const history = run.state().past.length; stamp('连续轴'); stamp('结束轴'); expect(run.state().past).toHaveLength(history);
  run.time(3000); stamp('起始轴'); expect(run.progress().completed).toBe(false); expect(run.state().present.lyrics.lines[1].words[0].beginMs).toBe(3000);
});
it('background stays in its own line and preserves the main mode preference', () => {
  const run = setup(true); stamp('choose last'); expect(screen.getByText('背景 · 本行')).toBeVisible();
  expect(screen.getByRole('combobox', { name: '打轴模式' })).toBeDisabled();
  stamp('起始轴'); run.time(1250); stamp('连续轴'); expect(run.progress().consumed).toBe(1);
  run.time(1500); stamp('连续轴'); expect(run.progress().completed).toBe(true);
  expect(run.state().present.lyrics.lines[0].words.every(word => word.beginMs === null)).toBe(true);
});
