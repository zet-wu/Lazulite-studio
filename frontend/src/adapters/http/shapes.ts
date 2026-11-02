import { requestHeaders, readApiError } from './client';
import { shapeRows, type ShapeTarget } from '../../domain/shape-conversion';
import { lineText, type LyricDocument } from '../../domain/lyric-document';

export async function analyzeShapes(source:LyricDocument,ids:string[],target:ShapeTarget,signal:AbortSignal) {
  const response=await fetch('/api/v1/shapes/analyze',{method:'POST',credentials:'include',signal,headers:requestHeaders({'Content-Type':'application/json'}),body:JSON.stringify({target,lines:source.lines.filter(line=>ids.includes(line.id)).map(line=>({id:line.id,text:lineText(line)}))})});
  if (!response.ok) throw await readApiError(response);
  return shapeRows(source,ids,await response.json());
}
