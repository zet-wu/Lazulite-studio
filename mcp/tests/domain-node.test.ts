import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { installXmlDomShim } from '../src/xml-shim';

const here = dirname(fileURLToPath(import.meta.url));
const ttmlFixturesDir = resolve(here, '../../tests/fixtures/ttml');

describe('Node 22 domain and adapter compatibility with @xmldom/xmldom', () => {
  beforeAll(() => {
    installXmlDomShim();
  });

  it('roundtrips all TTML fixtures identically across parseLyricTtml and serializeLyricTtml', async () => {
    const { parseLyricTtml, serializeLyricTtml } = await import('../../frontend/src/adapters/ttml/lyric-codec');
    const files = readdirSync(ttmlFixturesDir).filter((name) => name.endsWith('.ttml')).sort();
    expect(files.length).toBeGreaterThanOrEqual(8);

    for (const file of files) {
      const xml = readFileSync(resolve(ttmlFixturesDir, file), 'utf-8');
      const isDraft = file.includes('studio-roundtrip');
      const parsed = parseLyricTtml(xml, { draft: isDraft });
      expect(parsed.lines.length, `${file} should parse lines`).toBeGreaterThan(0);

      const serializedDraft = serializeLyricTtml(parsed, { draft: true });
      const reparsedDraft = parseLyricTtml(serializedDraft, { draft: true });
      expect(reparsedDraft, `${file} draft roundtrip mismatch`).toEqual(parsed);

      // Also verify standard export serialization and re-parse (where non-empty lines exist).
      const serializedExport = serializeLyricTtml(parsed, { draft: false });
      expect(serializedExport).toContain('xmlns="http://www.w3.org/ns/ttml"');
      expect(serializedExport).toContain('xml:space="preserve"');
      const reparsedExport = parseLyricTtml(serializedExport, { draft: false });
      expect(reparsedExport.lines.length).toBe(parsed.lines.length);
      expect(reparsedExport.agents).toEqual(parsed.agents);
      expect(reparsedExport.metadata).toEqual(parsed.metadata);
      expect(reparsedExport.language).toEqual(parsed.language);
    }
  });

  it('preserves whitespace escapes and rejects invalid XML cleanly', async () => {
    const { parseLyricTtml, serializeLyricTtml } = await import('../../frontend/src/adapters/ttml/lyric-codec');
    const { createLyricDocument, createLine, createWord } = await import('../../frontend/src/domain/lyric-document');

    const doc = createLyricDocument();
    const line = createLine('', 'line-1');
    line.beginMs = 1000;
    line.endMs = 2000;
    line.words = [
      { ...createWord('hello', 'w1'), beginMs: 1000, endMs: 1500 },
      { ...createWord(' \n', 'w2'), beginMs: null, endMs: null },
      { ...createWord('world', 'w3'), beginMs: 1500, endMs: 2000 },
    ];
    doc.lines = [line];

    const draftXml = serializeLyricTtml(doc, { draft: true });
    expect(draftXml).toContain('studio:id="w1"');
    expect(draftXml).toContain('xml:id="line-1"');
    const reparsed = parseLyricTtml(draftXml, { draft: true });
    expect(reparsed).toEqual(doc);

    expect(() => parseLyricTtml('<tt><unclosed></tt>')).toThrow();
  });

  it('runs parseProject, serializeProject, and executeProjectCommand cleanly in Node', async () => {
    const { parseProject, serializeProject } = await import('../../frontend/src/adapters/project-codec');
    const { createProjectDocument, createProjectEditorState, executeProjectCommand } = await import('../../frontend/src/domain/project-document');

    const project = createProjectDocument();
    let editor = createProjectEditorState(project);
    editor = executeProjectCommand(editor, {
      type: 'lyrics',
      command: { type: 'set-metadata', key: 'title', values: ['Test Song'] },
    });
    editor = executeProjectCommand(editor, {
      type: 'lyrics',
      command: { type: 'set-language', language: 'ja' },
    });
    const snapshot = serializeProject(editor.present);
    expect(snapshot.schemaVersion).toBe('studio-project-v9');
    expect(snapshot.lyrics.draftTtml).toContain('key="musicName" value="Test Song"');

    const restored = parseProject(snapshot);
    expect(restored).toEqual(editor.present);
  });

  it('imports LRC, ESLRC, QRC, YRC, KRC, and plain TXT via lyric-formats', async () => {
    const { importLyricFile } = await import('../../frontend/src/adapters/lyric-formats');

    const txt = importLyricFile('第一行\n第二行', 'txt');
    expect(txt.lines).toHaveLength(2);
    expect(txt.lines[0].words[0].text).toBe('第一行');

    const lrc = importLyricFile('[00:01.00]Hello\n[00:02.50]\n[00:03.00]World', 'lrc');
    expect(lrc.lines).toHaveLength(2);
    expect(lrc.lines[0].beginMs).toBe(1000);
    expect(lrc.lines[0].endMs).toBe(2500);
    expect(lrc.lines[1].beginMs).toBe(3000);
    expect(lrc.lines[1].endMs).toBeNull();

    const elrc = importLyricFile('[00:01.00]<00:01.00>Hel<00:01.50>lo<00:02.00>', 'elrc');
    expect(elrc.lines[0].words.map((w) => w.text)).toEqual(['Hel', 'lo']);
    expect(elrc.lines[0].endMs).toBe(2000);

    const qrcXml = importLyricFile('<QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[1000,1000]你好(1000,500)世界(1500,500)"/></LyricInfo></QrcInfos>', 'qrc');
    expect(qrcXml.lines[0].words.map((w) => w.text)).toEqual(['你好', '世界']);

    const yrc = importLyricFile('[1000,1000](1000,500,0)あ(1500,500,0)い', 'yrc');
    expect(yrc.lines[0].words.map((w) => w.text)).toEqual(['あ', 'い']);

    const krc = importLyricFile('[1000,1000]<0,500,0>か<500,500,0>な', 'krc');
    expect(krc.lines[0].words.map((w) => w.beginMs)).toEqual([1000, 1500]);
  });

  it('runs mergeAlignment accurately in Node', async () => {
    const { mergeAlignment } = await import('../../frontend/src/domain/alignment');
    const { createProjectDocument } = await import('../../frontend/src/domain/project-document');
    const { createLine, createWord } = await import('../../frontend/src/domain/lyric-document');

    const project = createProjectDocument();
    const line = createLine('', 'line-1');
    const word = { ...createWord('明日', 'w-1'), rubyUnits: [{ id: 'r-1', reading: 'あ', beginMs: null, endMs: null }, { id: 'r-2', reading: 'した', beginMs: null, endMs: null }] };
    line.words = [word];
    project.lyrics.lines = [line];
    project.lineOrder = ['line-1'];

    const merged = mergeAlignment(project, {
      kind: 'alignment',
      binding: { project_id: 'p1', revision: 'rev1', asset_id: 'a1' },
      alignment: {
        schema: 'lazulite-japanese-result-v1',
        units: [
          { unit_id: 'u1', line_id: 'line-1', proposed_timing: { start: { time: 1.0, source: 'ctc' }, end: { time: 1.2, source: 'ctc' } } },
          { unit_id: 'u2', line_id: 'line-1', proposed_timing: { start: { time: 1.25, source: 'ctc' }, end: { time: 1.8, source: 'ctc' } } },
        ],
      },
      mapping: [
        { unit_id: 'u1', object_id: 'r-1', word_id: 'w-1', line_id: 'line-1', kind: 'ruby' },
        { unit_id: 'u2', object_id: 'r-2', word_id: 'w-1', line_id: 'line-1', kind: 'ruby' },
      ],
      scope: [
        { object_id: 'r-1', word_id: 'w-1', line_id: 'line-1', kind: 'ruby', target_ids: ['u1'] },
        { object_id: 'r-2', word_id: 'w-1', line_id: 'line-1', kind: 'ruby', target_ids: ['u2'] },
      ],
      acoustics: { analysisId: 'ana-1', segments: [{ id: 's1', beginMs: 900, endMs: 2000 }] },
    }, 5000, false, 500);

    expect(merged.mergedGaps).toBe(1);
    const updatedLine = merged.project.lyrics.lines[0];
    expect(updatedLine.beginMs).toBe(1000);
    expect(updatedLine.endMs).toBe(1800);
    expect(updatedLine.words[0].rubyUnits[0].endMs).toBe(1250);
  });
});
