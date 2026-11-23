import { createKaraoke } from '../../frontend/src/domain/karaoke';
import { parseProject, serializeProject } from '../../frontend/src/adapters/project-codec';
import type { ProjectDocument } from '../../frontend/src/domain/project-document';
import { StudioClient } from '../src/client';

import { installXmlDomShim } from '../src/xml-shim';
installXmlDomShim();

export function projectFixture(doc: ProjectDocument, extra?: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  doc.karaoke = createKaraoke(doc.lyrics);
  let snapshot = serializeProject(doc), revision = 'r1', writes = 0;
  const client = new StudioClient({ baseUrl: 'http://localhost:15173', fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/document')) {
      if (init?.method === 'PUT') {
        if (new Headers(init.headers).get('If-Match') !== `"${revision}"`) return Response.json({ code: 'revision_conflict', message: 'Conflict', retryable: false }, { status: 412 });
        snapshot = JSON.parse(String(init.body)).document; revision = `r${++writes + 1}`;
        return Response.json({ revision });
      }
      return Response.json({ project_id: 'p', revision, document: snapshot, source_asset_id: null });
    }
    if (extra) return extra(url, init);
    throw new Error(`Unexpected request ${url}`);
  } });
  return { client, doc: () => parseProject(snapshot), revision: () => revision, writes: () => writes };
}
