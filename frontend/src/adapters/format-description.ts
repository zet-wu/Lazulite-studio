import type { LyricDocument } from '../domain/lyric-document';
import type { LyricFormat } from './lyric-formats';

/** Document-wide information, deliberately separate from actionable output issues. */
export function describeLyricFormat(document: LyricDocument, format: LyricFormat): string[] {
  if (format === 'ttml') return ['TTML 导出保留 Ruby、翻译与音译轨道、语言、类型、内容时间及背景关系；最终文件不包含 Studio 编辑标识。'];
  const notes: string[] = [];
  const words = document.lines.flatMap(line => line.words);
  if (words.some(word => word.rubyUnits.length)) notes.push('当前导出不保留 Ruby 结构及读音时间，保留正文。');
  if (document.translationTracks.length) notes.push(format === 'ass'
    ? '翻译按行以 / 合并为普通字幕，使用正文字幕时间，不保留轨道、语言、类型及独立单元时间。'
    : '当前导出不输出翻译内容及轨道信息。');
  if (document.romanizationTracks.length) notes.push(format === 'ass'
    ? '音译仅输出预览中的整行投影，使用正文字幕时间；逐词附着音译、多轨、语言及独立时间不保留。'
    : '当前导出不输出音译内容及轨道信息。');
  if (document.lines.some(line => line.backgroundOf)) notes.push(['txt', 'lrc', 'elrc'].includes(format)
    ? '当前导出不输出背景行。'
    : format === 'ass' ? '背景正文输出为带 -bg 名称的字幕，不保留与主行的关联。'
    : format === 'lys' ? '背景正文保留背景标志，不保留与主行的关联。'
    : format === 'eslrc' ? '背景正文作为普通行输出，不保留背景标志及主行关联。'
    : '背景正文以括号标记，不保留与主行的关联。');
  if (format === 'txt' && document.lines.some(line => line.beginMs !== null || line.endMs !== null || line.words.some(word => word.beginMs !== null || word.endMs !== null))) notes.push('纯文本不保留行及逐词时间。');
  if (format === 'lrc') notes.push('普通 LRC 输出主行开始时间，用空时间标签表达可输出的段尾；不保留逐词时间及重叠行各自的结束边界。');
  if (format === 'elrc') notes.push('扩展 LRC 输出主行及逐词时间，不保留独立的附属内容结构。');
  if (format === 'ass') notes.push('ASS 当前输出卡拉 OK 正文字幕；字幕边界取正文词范围，时间精度为厘秒。');
  return notes.length ? notes : ['当前文档未包含需要额外说明的 Ruby、翻译、音译或背景结构。'];
}
