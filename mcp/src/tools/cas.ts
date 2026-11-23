import { parseProject, serializeProject } from '../../../frontend/src/adapters/project-codec';
import type { ProjectDocument } from '../../../frontend/src/domain/project-document';
import { StudioHttpError, type StudioClient, type StudioDocumentEnvelope } from '../client';

export type MutationResult<TExtra extends Record<string, unknown>> = {
  project_id: string;
  changed: boolean;
  previous_revision: string;
  new_revision: string;
} & TExtra;

/**
 * Execute an optimistic-concurrency CAS document mutation:
 * read latest revision -> validate & transform domain document -> serialize -> PUT with If-Match & Idempotency-Key.
 */
export async function mutateProjectDocument<TExtra extends Record<string, unknown>>(
  client: StudioClient,
  projectId: string,
  options: { expectedRevision?: string; idempotencyKey?: string; dryRun?: boolean },
  mutate: (
    doc: ProjectDocument,
    envelope: StudioDocumentEnvelope,
  ) => { nextDoc: ProjectDocument; summary: TExtra } | Promise<{ nextDoc: ProjectDocument; summary: TExtra }>,
): Promise<MutationResult<TExtra>> {
  const envelope = await client.getDocumentEnvelope(projectId);
  if (options.expectedRevision && envelope.revision !== options.expectedRevision) {
    throw new StudioHttpError(412, {
      code: 'revision_conflict',
      message: `Expected revision "${options.expectedRevision}", but current revision is "${envelope.revision}"`,
      retryable: false,
      current_revision: envelope.revision,
    });
  }

  const currentDoc = parseProject(envelope.document);
  const { nextDoc, summary } = await mutate(currentDoc, envelope);
  if (nextDoc === currentDoc) {
    return {
      project_id: projectId,
      changed: false,
      previous_revision: envelope.revision,
      new_revision: envelope.revision,
      ...summary,
    };
  }

  const snapshot = serializeProject(nextDoc);
  if (options.dryRun) return { project_id: projectId, changed: false, previous_revision: envelope.revision, new_revision: envelope.revision, ...summary };
  const saved = await client.saveDocument(
    projectId,
    snapshot,
    envelope.revision,
    options.idempotencyKey || crypto.randomUUID(),
    envelope.etag,
  );
  return {
    project_id: projectId,
    changed: true,
    previous_revision: envelope.revision,
    new_revision: saved.revision,
    ...summary,
    ...('revision' in summary ? { revision: saved.revision } : {}),
  };
}
