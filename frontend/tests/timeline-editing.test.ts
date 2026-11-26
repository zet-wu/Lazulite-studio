import { describe, expect, it } from 'vitest';
import { createLine, createLyricDocument, createWord } from '../src/domain/lyric-document';
import { createLyricEditorState, executeLyricCommand, undoLyricCommand, redoLyricCommand } from './helpers/project-history';
import { closeTimelineGap, timelineReadingGaps, moveTimeline, resizeTimeline, resizeTimelineBoundary, snapTime } from '../src/domain/timeline-editing';

describe('E6 timeline editing', () => {
  const sample = () => {
    const document = createLyricDocument('今日');
    const line = document.lines[0], word = line.words[0];
    line.beginMs = 1000; line.endMs = 4000;
    word.beginMs = 1000; word.endMs = 3000;
    word.rubyUnits = [
      { id: 'r1', reading: 'きょ', beginMs: 1000, endMs: 2000 },
      { id: 'r2', reading: 'う', beginMs: 2000, endMs: 3000 },
    ];
    line.words.push({ ...createWord('も', 'also'), beginMs: 3000, endMs: 4000 });
    const background = createLine('響く', 'bg');
    background.backgroundOf = line.id; background.beginMs = 1500; background.endMs = 2500;
    background.words[0].beginMs = 1500; background.words[0].endMs = 2500;
    document.lines.push(background);
    return document;
  };

  it('moves only the explicitly selected line and its own children in one undo step', () => {
    const document = sample();
    const moved = moveTimeline(document, [{ kind: 'line', lineId: document.lines[0].id }], 500);
    const state = executeLyricCommand(createLyricEditorState(document), { type: 'replace-document', document: moved });
    expect(state.present.lines[0].words[0].rubyUnits[0].beginMs).toBe(1500);
    expect(state.present.lines[1]).toBe(document.lines[1]);
    expect(undoLyricCommand(state).present).toBe(document);
  });

  it('moves explicit background and main selections once, including their own timed romanization', () => {
    const document = sample();
    document.romanizationTracks = [{ id: 'track', language: 'ja-Latn', contents: document.lines.map(line => ({ id: `roman-${line.id}`, lineId: line.id, kind: 'timed', units: [{ id: `unit-${line.id}`, text: ' a ', beginMs: 1600, endMs: 2000 }] })) }];
    const background = moveTimeline(document, [{ kind: 'line', lineId: 'bg' }], 100);
    expect(background.lines[0]).toBe(document.lines[0]);
    expect(background.lines[1].beginMs).toBe(1600);
    expect(background.romanizationTracks[0].contents[0]).toBe(document.romanizationTracks[0].contents[0]);
    const both = moveTimeline(document, document.lines.flatMap(line => [{ kind: 'line' as const, lineId: line.id }, { kind: 'line' as const, lineId: line.id }]), 100);
    expect(both.lines.map(line => line.beginMs)).toEqual([1100, 1600]);
    expect(both.romanizationTracks[0].contents.map(content => content.kind === 'timed' && content.units[0].beginMs)).toEqual([1700, 1700]);
  });

  it('resizes a 注音 edge and updates its parent without changing another word', () => {
    const document = sample();
    const target = { kind: 'ruby' as const, lineId: document.lines[0].id, wordId: document.lines[0].words[0].id, rubyId: 'r2' };
    const changed = resizeTimeline(document, target, 'endMs', 3500);
    expect(changed.lines[0].words[0]).toMatchObject({ beginMs: 1000, endMs: 3500 });
    expect(changed.lines[0].words[1]).toBe(document.lines[0].words[1]);
    expect(() => resizeTimeline(document, { kind: 'line', lineId: document.lines[0].id }, 'endMs', 2000)).toThrow('timeline.lineExcludesWords');
  });

  it('moves selected words together and rejects negative times while snapping near a beat', () => {
    const document = sample();
    const targets = document.lines[0].words.map((word) => ({ kind: 'word' as const, lineId: document.lines[0].id, wordId: word.id }));
    const moved = moveTimeline(document, targets, 250);
    expect(moved.lines[0].words.map((word) => word.beginMs)).toEqual([1250, 3250]);
    expect(() => moveTimeline(document, targets, -2000)).toThrow('timeline.rangeInvalid');
    expect(snapTime(1498, [1000, 1500, 2000], 10_000)).toBe(1500);
  });
});

it.each([false,true])('ruby crossing updates both parent envelope edges and commits atomically, linked=%s', linked => {
  const document=createLyricDocument('あい'),line=document.lines[0],word=line.words[0];
  Object.assign(line,{beginMs:0,endMs:4000});Object.assign(word,{beginMs:1000,endMs:2000});
  word.rubyUnits=[{id:'r',reading:'あい',beginMs:1000,endMs:2000}];
  const target={kind:'ruby' as const,lineId:line.id,wordId:word.id,rubyId:'r'};
  for(const [side,time,begin,end] of [['beginMs',2500,2000,2500],['endMs',500,500,1000]] as const){
    const next=resizeTimelineBoundary(document,target,side,time,linked);
    const state=executeLyricCommand(createLyricEditorState(document),{type:'replace-document',document:next});
    expect(state.present.lines[0].words[0]).toMatchObject({beginMs:begin,endMs:end});
    expect(undoLyricCommand(state).present).toBe(document);
  }
});

it.each([20,-20])('closes within-word, cross-word ruby and mixed gaps atomically (%s)',gap=>{
 const document=createLyricDocument(''),line=createLine('','l');document.lines=[line];
 Object.assign(line,{beginMs:100,endMs:800});
 line.words=[{...createWord('愛','a'),beginMs:100,endMs:400,rubyUnits:[{id:'r1',reading:'あ',beginMs:100,endMs:200},{id:'r2',reading:'い',beginMs:200+gap,endMs:400}]},
 {...createWord('詩','b'),beginMs:400+gap,endMs:600,rubyUnits:[{id:'r3',reading:'し',beginMs:400+gap,endMs:600}]},
 {...createWord('よ','c'),beginMs:600+gap,endMs:900}];
 const gaps=timelineReadingGaps(line);expect(gaps).toHaveLength(3);expect(gaps.every(g=>g.overlap===(gap<0))).toBe(true);
 let next=document;for(const g of gaps)next=closeTimelineGap(next,g.leftTarget,g.rightTarget);
 const state=executeLyricCommand(createLyricEditorState(document),{type:'replace-document',document:next});
 expect(next.lines[0].words.map(w=>[w.beginMs,w.endMs])).toEqual([[100,400+gap/2],[400+gap/2,600+gap/2],[600+gap/2,900]]);
 expect(next.lines[0].words[0].rubyUnits[0].endMs).toBe(200+gap/2);
 expect(next.lines[0]).toMatchObject({beginMs:100,endMs:900});
 expect(undoLyricCommand(state).present).toBe(document);expect(redoLyricCommand(undoLyricCommand(state)).present).toEqual(next);
 expect(()=>executeLyricCommand(state,{type:'set-ruby-time',lineId:'l',wordId:'a',rubyId:'r1',beginMs:0,endMs:150})).toThrow('command.rubyTimeOutside');
});
it('does not reverse leaf times when closing overlaps and ignores missing endpoints',()=>{
 const document=createLyricDocument(''),line=createLine('','l');document.lines=[line];
 line.words=[{...createWord('a','a'),beginMs:100,endMs:300},{...createWord('b','b'),beginMs:50,endMs:120}];
 const [gap]=timelineReadingGaps(line);expect(closeTimelineGap(document,gap.leftTarget,gap.rightTarget)).toEqual(document);
 line.words[1].beginMs=null;expect(timelineReadingGaps(line)).toEqual([]);
});
