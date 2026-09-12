import { describe, expect, it } from 'vitest';
import { createStudioDocument, parseStudioTtml, serializeStudioTtml } from '../src/adapters/ttml/codec';
import golden from './fixtures/ttml-golden.xml?raw';
function maskNode(root: unknown, path: number[]): unknown {
    const copy = structuredClone(root) as {
        children?: Array<{
            type?: string;
            children?: unknown[];
        }>;
    };
    let current: any = copy;
    for (const index of path.slice(0, -1))
        current = (current.children?.filter((child: {
            type?: string;
        }) => child.type === 'element')[index] as {
            children: unknown[];
        });
    const target = current.children?.filter((child: {
        type?: string;
    }) => child.type === 'element')[path[path.length - 1]];
    if (target)
        (target as {
            children: Array<{
                type: string;
            }>;
        }).children = [{ type: 'edited-line' }];
    return copy;
}
describe('Studio TTML codec', () => {
    const editableGolden = golden.replace(' ext:flag="yes"', '');
    it('projects stable ids, Ruby code-point ranges and read-only structured text', () => {
        const document = parseStudioTtml(editableGolden);
        expect(document.lines.map(line => line.id)).toEqual(['line-1-0-0', 'line-1-0-1', 'line-1-0-2', 'line-1-0-3', 'line-1-0-4']);
        expect(document.lines[0]).toMatchObject({ xmlId: 'p1', text: ' A 𝄞 é 今日\n ', editable: { text: false }, ruby: [{ baseStart: 8, baseEnd: 10 }] });
    });
    it('edits a plain line and retains neighboring Ruby and extension nodes after reparse', () => {
        const document = parseStudioTtml(editableGolden);
        const baselineTree = document.baseline.root;
        document.lines[1].text = 'changed';
        const xml = serializeStudioTtml(document, { draft: true });
        expect(xml).toContain('extension text');
        expect(xml).toContain('きょう');
        expect(parseStudioTtml(xml).lines[1].text).toBe('changed');
        expect(parseStudioTtml(xml).lines[0].ruby[0].reading).toBe('きょう');
        expect(maskNode(parseStudioTtml(xml).root, document.lines[1].sourcePath)).toEqual(maskNode(baselineTree, document.lines[1].sourcePath));
        expect(xml).toContain('begin="10f"');
        expect(xml).not.toContain('studio:null="begin end"');
    });
    it('writes edited absolute timing back as parent-relative timing', () => {
        const document = parseStudioTtml(editableGolden);
        document.lines[1].beginUs = 4000000;
        document.lines[1].endUs = 5000000;
        const reparsed = parseStudioTtml(serializeStudioTtml(document, { draft: true }));
        expect(reparsed.lines[1]).toMatchObject({ beginUs: 4000000, endUs: 5000000 });
        const withDur = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="1s" dur="5s"><p begin="1s" dur="2s">x</p></div></body></tt>');
        withDur.lines[0].beginUs = 3000000;
        const durXml = serializeStudioTtml(withDur, { draft: true });
        expect(durXml).not.toContain('dur="2s"');
        expect(parseStudioTtml(durXml).lines[0].endUs).toBe(4000000);
    });
    it('rejects an edited time before the parallel parent', () => {
        const document = parseStudioTtml(editableGolden);
        document.lines[1].beginUs = 1000000;
        expect(() => serializeStudioTtml(document, { draft: true })).toThrow(/parent/);
        document.lines[1].beginUs = Number.MAX_SAFE_INTEGER + 1;
        expect(() => serializeStudioTtml(document, { draft: true })).toThrow(/invalid begin/);
        document.lines[1].beginUs = 4000000;
        document.lines[1].endUs = 3000000;
        expect(() => serializeStudioTtml(document, { draft: true })).toThrow(/precedes/);
    });
    it('round-trips draft null markers and requires complete final timing', () => {
        const document = createStudioDocument();
        const draft = serializeStudioTtml(document, { draft: true });
        expect(draft).toContain('studio:null="begin end"');
        expect(parseStudioTtml(draft).lines[0]).toMatchObject({ beginUs: null, endUs: null });
        expect(() => serializeStudioTtml(document)).toThrow(/complete valid/);
    });
    it('serializes a self-closing empty line when its text is edited', () => {
        const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p xml:id="empty" begin="1s" end="2s"/></body></tt>');
        document.lines[0].text = 'filled';
        const xml = serializeStudioTtml(document);
        expect(xml).toContain('<p xml:id="empty" begin="1s" end="2s">filled</p>');
        expect(parseStudioTtml(xml).lines[0].text).toBe('filled');
    });
    it('retains actor references and reports unknown namespaces locally', () => {
        const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ext="urn:x"><head><ttm:agent xml:id="a"><ttm:name>A</ttm:name><ttm:actor agent="missing"/></ttm:agent></head><body><p ttm:agent="a" ext:flag="yes">ok<ext:mark/></p></body></tt>';
        const document = parseStudioTtml(xml);
        expect(document.agents[0]).toMatchObject({ id: 'a', name: 'A' });
        expect(document.agents[0].actorRef).toBe('missing');
        expect(document.issues.some(issue => issue.code === 'dangling-actor')).toBe(true);
        expect(document.lines[0].editable.text).toBe(false);
        expect(document.lines[0].locks.text).toMatch(/Unknown line attribute/);
        expect(document.issues.some(issue => issue.code === 'unknown-namespace')).toBe(true);
        expect(document.extensions.length).toBeGreaterThan(0);
        const cycle = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><head><ttm:agent xml:id="a"><ttm:actor agent="b"/></ttm:agent><ttm:agent xml:id="b"><ttm:actor agent="a"/></ttm:agent></head><body/></tt>');
        expect(cycle.issues.some(issue => issue.code === 'agent-cycle')).toBe(true);
    });
    it('locks a line containing an unknown inline namespace', () => {
        const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ext="urn:extension"><body><p>ok<ext:mark>?</ext:mark></p></body></tt>');
        expect(document.lines[0].editable.text).toBe(false);
        expect(document.lines[0].locks.text).toBeDefined();
    });
    it('returns an editable starter document with an intentionally incomplete line', () => {
        const document = createStudioDocument();
        expect(document.lines).toHaveLength(1);
        expect(document.lines[0].editable).toEqual({ text: true, timing: true });
    });

    it('round-trips whole-word Ruby with code-point ranges, including non-BMP text', () => {
        const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p>𝄞今日と宇宙</p></body></tt>');
        const line = document.lines[0];
        expect(line.editable.text).toBe(true);
        line.ruby = [
            { id: `${line.id}-ruby-1-3`, base: '今日', reading: 'きょう', baseStart: 1, baseEnd: 3 },
            { id: `${line.id}-ruby-4-6`, base: '宇宙', reading: 'そら', baseStart: 4, baseEnd: 6 },
        ];
        const xml = serializeStudioTtml(document, { draft: true });
        const reparsed = parseStudioTtml(xml);
        expect(reparsed.lines[0]).toMatchObject({ text: '𝄞今日と宇宙', ruby: [
            { base: '今日', reading: 'きょう', baseStart: 1, baseEnd: 3 },
            { base: '宇宙', reading: 'そら', baseStart: 4, baseEnd: 6 },
        ] });
        expect(xml).toContain('tts:ruby="container"');
    });

    it('keeps the following Ruby id after deleting the preceding span and round-tripping', () => {
        const document = parseStudioTtml('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><p>今日宇宙</p></body></tt>');
        const line = document.lines[0];
        line.ruby = [
            { id: `${line.id}-ruby-0-2`, base: '今日', reading: 'きょう', baseStart: 0, baseEnd: 2 },
            { id: `${line.id}-ruby-2-4`, base: '宇宙', reading: 'そら', baseStart: 2, baseEnd: 4 },
        ];
        const followingId = line.ruby[1].id;
        line.ruby = [line.ruby[1]];
        const reparsed = parseStudioTtml(serializeStudioTtml(document, { draft: true }));
        expect(reparsed.lines[0].ruby[0].id).toBe(followingId);
    });
});
