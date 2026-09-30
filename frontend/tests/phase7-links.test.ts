import { expect, it } from 'vitest';
import { createLine, createWord, createLyricDocument } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from '../src/domain/lyric-commands';
import { parseLyricTtml, serializeLyricTtml } from '../src/adapters/ttml/lyric-codec';
import { lineStructureIssues } from '../src/domain/line-structure';
function fixture() {
  const doc = createLyricDocument();
  doc.lines = ['a', 'b', 'c', 'incoming'].map((id, i) => ({ ...createLine(id, id), beginUs: i * 2_000_000, endUs: (i + 1) * 2_000_000, words: [] }));
  doc.lines[0].words = [0, 1].map(i => ({ ...createWord(String(i), `w${i}`), beginUs: i * 1_000_000, endUs: (i + 1) * 1_000_000 }));
  doc.lines[0].endLink = { targetLineId: 'b', originalEndUs: 2_500_000 };
  doc.lines[1].endLink = { targetLineId: 'c', originalEndUs: 4_500_000 };
  return doc;
}
it('splits linked lines preserving incoming links, cancellation state, target updates and atomic history', () => {
  const doc = fixture(); doc.lines[3].endUs = 0; doc.lines[3].beginUs = 0;
  doc.lines[3].endLink = { targetLineId: 'a', originalEndUs: 0 };
  const before = createLyricEditorState(doc);
  const split = executeLyricCommand(before, { type: 'split-line', lineId: 'a', beforeWordId: 'w1', newLineId: 'new', contentIdsForNewLine: [], backgroundTarget: null });
  expect(split.present.lines[0]).toMatchObject({ id: 'a', endUs: 1_000_000, endLink: null });
  expect(split.present.lines[1].endLink).toEqual(doc.lines[0].endLink);
  expect(split.present.lines.at(-1)!.endLink!.targetLineId).toBe('a');
  expect(undoLyricCommand(split).present).toBe(doc);
  expect(redoLyricCommand(undoLyricCommand(split)).present).toBe(split.present);
  expect(parseLyricTtml(serializeLyricTtml(split.present, { draft: true })).lines[1].endLink).toEqual(doc.lines[0].endLink);
  const moved = executeLyricCommand(split, { type: 'set-line-time', lineId: 'b', beginUs: 3_000_000, endUs: 4_000_000 });
  expect(moved.present.lines[1].endUs).toBe(3_000_000);
  expect(executeLyricCommand(moved, { type: 'unlink-line-end', lineId: 'new' }).present.lines[1].endUs).toBe(2_500_000);
  expect(serializeLyricTtml(split.present)).not.toContain('endLink');
});
it('merges the internal chain and inherits the last external link and original end', () => {
  const doc = fixture(), state = createLyricEditorState(doc);
  const result = executeLyricCommand(state, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' });
  expect(result.present.lines[0]).toMatchObject({ id: 'a', endUs: 4_000_000, endLink: doc.lines[1].endLink });
  expect(executeLyricCommand(result, { type: 'unlink-line-end', lineId: 'a' }).present.lines[0].endUs).toBe(4_500_000);
  expect(undoLyricCommand(result).present).toBe(doc);
});
it('reports all real conflicts with source ordinals and safely rebinds identical starts', () => {
  const doc = fixture(); doc.lines[3].endLink = { targetLineId: 'b', originalEndUs: 8_000_000 }; doc.lines[3].endUs = 2_000_000;
  doc.lines[0].translations = [{ language: 'en', text: 'a' }]; doc.lines[1].translations = [{ language: 'ja', text: 'b' }];
  doc.lines[1].agentRefs = ['v2']; doc.lines[1].songPart = 'verse';
  const issues = lineStructureIssues(doc, doc.lines[0], doc.lines[1]);
  expect(issues).toHaveLength(5); expect(issues.join('；')).toContain('L4行尾链接 → L2');
  const state = createLyricEditorState(doc);
  expect(() => executeLyricCommand(state, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' })).toThrow(issues.join('；'));
  expect(state.present).toBe(doc); expect(state.past).toHaveLength(0);
  doc.lines[0].translations = []; doc.lines[1].translations = []; doc.lines[1].agentRefs = []; doc.lines[1].songPart = null;
  doc.lines[0].beginUs = 2_000_000; doc.lines[0].words = [];
  const safe = executeLyricCommand(state, { type: 'merge-lines', firstLineId: 'a', secondLineId: 'b' });
  expect(safe.present.lines.at(-1)!.endLink!.targetLineId).toBe('a');
  doc.lines[0].endLink = { targetLineId: 'c', originalEndUs: 2_000_000 };
  expect(lineStructureIssues(doc, doc.lines[0], doc.lines[1])).toEqual(['L1行尾链接 → L3在合并范围外']);
});
