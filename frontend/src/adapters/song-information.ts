import type { LyricDocument } from '../domain/lyric-document';

const tags = { title: 'Title', artist: 'Artist', album: 'Album', composer: 'Compose', lyricist: 'Lyrics', arranger: 'Arrange', year: 'Year' } as const;
/** Shared semantic mapping; each output owns its string encoding. */
export function songInformation(metadata: LyricDocument['metadata']) {
  return Object.entries(tags).map(([key, tag]) => ({ key, tag, value: metadata[key]?.join(' / ').replace(/[\r\n\u2028\u2029]+/g, ' ') ?? '' }));
}
