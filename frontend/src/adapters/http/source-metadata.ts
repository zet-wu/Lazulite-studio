import { message, MessageError } from '../../domain/messages';
import { ApiError, apiJson } from './client';
export type SongMetadata = { title: string; artist: string; album: string };
export async function readSourceMetadata(projectId: string, assetId: string, signal: AbortSignal, tagsOnly = true): Promise<SongMetadata> {
  let result: { asset_id?: string; conditions?: Record<string, unknown> };
  try {
    result = await apiJson(`/projects/${encodeURIComponent(projectId)}/source-metadata${tagsOnly ? '?tags_only=true' : ''}`, { signal });
  } catch (error) {
    if (error instanceof ApiError) throw new MessageError(message('search.tagsReadFailed'));
    throw error;
  }
  if (result.asset_id !== assetId) throw new MessageError(message('search.tagsSourceChanged'));
  if (!result.conditions || ['title','artist','album'].some(key => typeof result.conditions![key] !== 'string')) throw new MessageError(message('search.tagsInvalid'));
  return result.conditions as SongMetadata;
}
