import { message, MessageError } from '../../domain/messages';
import { requestHeaders } from './client';
export type SongMetadata = { title: string; artist: string; album: string };
export async function readSourceMetadata(projectId: string, assetId: string, signal: AbortSignal): Promise<SongMetadata> {
  const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/source-metadata`, { credentials: 'include', headers: requestHeaders(), signal });
  if (!response.ok) throw new MessageError(message('search.tagsReadFailed'));
  const result = await response.json();
  if (result.asset_id !== assetId) throw new MessageError(message('search.tagsSourceChanged'));
  if (!result.conditions || ['title','artist','album'].some(key => typeof result.conditions[key] !== 'string')) throw new MessageError(message('search.tagsInvalid'));
  return result.conditions;
}
