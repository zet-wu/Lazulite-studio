import { expect, it } from 'vitest';
import { createProjectDocument, createProjectEditorState, executeProjectCommand } from '../src/domain/project-document';
import { createLyricDocument } from '../src/domain/lyric-document';
import { assertChangedTimes, intersectSegments, projectTimes } from '../src/domain/time-boundaries';
import { audioRangeIssues } from '../src/adapters/audio-validation';
import { parseProject, serializeProject } from '../src/adapters/project-codec';
import { exportLyricFile } from '../src/adapters/lyric-formats';

it('preserves over-source snapshots and reports endpoint warnings independently of export', () => {
  const project = createProjectDocument(createLyricDocument('歌'));
  const line=project.lyrics.lines[0],word=line.words[0];
  Object.assign(line,{beginMs:9000,endMs:12000});
  Object.assign(word,{beginMs:10000,endMs:11500,rubyUnits:[{id:'ruby',reading:'うた',beginMs:10200,endMs:11000}]});
  project.acoustics.segments=[{id:'segment',beginMs:11000,endMs:12000}];
  expect(parseProject(serializeProject(project))).toEqual(project);
  const issues=audioRangeIssues(project.lyrics,project.acoustics,'source',10000);
  expect(issues).toHaveLength(6);
  expect(issues.every(i=>i.severity==='warning')).toBe(true);
  expect(issues.find(i=>i.segmentId==='segment')).toMatchObject({endpoint:'beginMs',excessMs:1000,sourceDurationMs:10000});
  expect(audioRangeIssues(project.lyrics,project.acoustics,'source',undefined)).toEqual([]);
  expect(audioRangeIssues(project.lyrics,project.acoustics,'shorter',9000).length).toBeGreaterThan(issues.length);
  expect(exportLyricFile(project.lyrics,'ttml',project.editing)).toContain('12.000');
});
it('checks the final linked candidate while retaining unchanged out-of-range ends', () => {
  const project=createProjectDocument(createLyricDocument('歌'));
  const line=project.lyrics.lines[0];line.beginMs=8000;line.endMs=12000;
  let next=structuredClone(project);next.lyrics.lines[0].beginMs=9000;
  expect(()=>assertChangedTimes(projectTimes(project),projectTimes(next),10000)).not.toThrow();
  next.lyrics.lines[0].endMs=13000;
  expect(()=>assertChangedTimes(projectTimes(project),projectTimes(next),10000)).toThrow('time.endOutsideSource');
  line.endMs=9500;
  next=executeProjectCommand(createProjectEditorState(project),{type:'lyrics',command:{type:'shift-lines',lineIds:[line.id],deltaMs:1000}}).present;
  expect(()=>assertChangedTimes(projectTimes(project),projectTimes(next),10000)).toThrow('time.endOutsideSource');
  expect(()=>assertChangedTimes(projectTimes(project),projectTimes(next),null)).toThrow('time.sourceUnknown');
});
it('intersects automatic intervals with source duration without touching media metadata',()=>{
  const segments=[{id:'a',beginMs:900,endMs:1022},{id:'b',beginMs:1021,endMs:1500},{id:'c',beginMs:0,endMs:100}];
  expect(intersectSegments(segments,1021)).toEqual({segments:[{id:'a',beginMs:900,endMs:1021},segments[2]],clipped:1,dropped:1});
  expect(segments[0].endMs).toBe(1022);
});
