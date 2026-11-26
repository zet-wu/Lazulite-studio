import { deflateSync } from 'node:zlib';
import { computeSpectrogram, SPECTRUM_WIDTH, SPECTRUM_HEIGHT } from '../../frontend/src/domain/spectrogram';
import { displayLines } from '../../frontend/src/domain/amll-compatibility';
import { timeEnvelope } from '../../frontend/src/domain/lyric-commands';
import { readingLeaves } from '../../frontend/src/domain/reading-units';
import { timelineReadingGaps } from '../../frontend/src/domain/timeline-editing';
import type { ProjectDocument } from '../../frontend/src/domain/project-document';
import { StudioHttpError } from './client';

const WIDTH = 840, HEIGHT = 280, LEFT = 40, RIGHT = 832, TOP = 28, BOTTOM = 196;
const invalidAudio = (message: string): never => { throw new StudioHttpError(422, {code:'invalid_audio',message,retryable:false}); };

/** The excerpt boundary accepts only the backend's 16 kHz mono 16-bit PCM WAV. */
export function excerptPcm(bytes: Buffer): Int16Array {
  if (bytes.length < 12 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WAVE') invalidAudio('Expected a PCM WAV audio excerpt.');
  let format = false, data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii',offset,offset+4), size = bytes.readUInt32LE(offset+4), start = offset+8;
    if (start + size > bytes.length) invalidAudio('Truncated WAV chunk.');
    if (kind === 'fmt ') {
      if (size < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start+2) !== 1 || bytes.readUInt32LE(start+4) !== 16000 || bytes.readUInt16LE(start+14) !== 16) invalidAudio('Expected 16 kHz mono 16-bit PCM.');
      format = true;
    } else if (kind === 'data') data = bytes.subarray(start,start+size);
    offset = start + size + (size % 2);
  }
  if (!format || !data?.length || data.length % 2) invalidAudio('Audio excerpt has no complete PCM samples.');
  const pcm = new Int16Array(data!.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data!.readInt16LE(i*2);
  return pcm;
}

const CRC_TABLE = Uint32Array.from({length:256},(_,n)=>{
  let value=n;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
function chunk(kind:string,data:Buffer):Buffer {
  const tag=Buffer.from(kind),body=Buffer.concat([tag,data]);let crc=0xffffffff;
  for(const byte of body)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);
  const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);body.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;
}
function png(pixels:Buffer):Buffer {
  const header=Buffer.alloc(13);header.writeUInt32BE(WIDTH);header.writeUInt32BE(HEIGHT,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc((WIDTH*3+1)*HEIGHT);
  for(let y=0;y<HEIGHT;y++)pixels.copy(rows,y*(WIDTH*3+1)+1,y*WIDTH*3,(y+1)*WIDTH*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

// Fixed 5×7 ASCII glyphs keep packaging independent of native font libraries.
const GLYPHS:Record<string,string[]>={
 '0':['01110','10001','10011','10101','11001','10001','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
 '.':['00000','00000','00000','00000','00000','00110','00110'],
 's':['00000','00000','01111','10000','01110','00001','11110'],
 'k':['10000','10000','10010','10100','11000','10100','10010'],
 'L':['10000','10000','10000','10000','10000','10000','11111'],
};
type Color=readonly[number,number,number];
const INK:Color=[218,235,248], PALETTE:Color[]=[[11,19,43],[21,63,110],[20,167,182],[230,207,86],[255,252,223]];
const UNIT_COLORS:Color[]=[[39,117,152],[103,77,148],[39,133,111],[153,97,53]];
function spectrumColor(value:number):Color {
  const position=value/255*(PALETTE.length-1),index=Math.min(PALETTE.length-2,Math.floor(position)),f=position-index;
  return PALETTE[index].map((v,i)=>Math.round(v*(1-f)+PALETTE[index+1][i]*f)) as unknown as Color;
}

export function renderTimelineVisual(bytes:Buffer,doc:ProjectDocument,range:[number,number]) {
  const pcm=excerptPcm(bytes),spectrum=computeSpectrogram(pcm,16000,1),[start,end]=range;
  const visible=(begin:number|null,finish:number|null)=>begin!==null&&finish!==null&&finish>start&&begin<end;
  const ordered=displayLines(doc.lyrics,doc.lineOrder);
  const lines=ordered.flatMap((line,ordinal)=>{
    const span=timeEnvelope([line,...line.words,...line.words.flatMap(word=>word.rubyUnits)]);
    return visible(span.beginMs,span.endMs)?[{index:0,line_id:line.id,line_number:ordinal+1,begin_ms:span.beginMs!,end_ms:span.endMs!}]:[];
  }).map((line,index)=>({...line,index:index+1}));
  const units=ordered.flatMap(line=>readingLeaves(line).flatMap(leaf=>visible(leaf.value.beginMs,leaf.value.endMs)?[{
    index:0,unit_id:leaf.value.id,word_id:line.words[leaf.wordIndex].id,line_id:line.id,kind:leaf.rubyIndex===null?'word':'ruby',text:leaf.text,
    begin_ms:leaf.value.beginMs!,end_ms:leaf.value.endMs!,duration_ms:leaf.value.endMs!-leaf.value.beginMs!,
  }]:[])).map((unit,index)=>({...unit,index:index+1}));
  const segments=doc.acoustics.segments.filter(s=>visible(s.beginMs,s.endMs)).map(s=>({segment_id:s.id,begin_ms:s.beginMs,end_ms:s.endMs}));
  const pixels=Buffer.alloc(WIDTH*HEIGHT*3);
  const pixel=(x:number,y:number,color:Color)=>{if(x<0||x>=WIDTH||y<0||y>=HEIGHT)return;const i=(Math.floor(y)*WIDTH+Math.floor(x))*3;pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];};
  const rect=(x:number,y:number,w:number,h:number,color:Color)=>{for(let yy=Math.max(0,Math.floor(y));yy<Math.min(HEIGHT,y+h);yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(WIDTH,x+w);xx++)pixel(xx,yy,color);};
  const label=(text:string,x:number,y:number,color:Color=INK)=>{for(const char of text){const glyph=GLYPHS[char];glyph?.forEach((row,yy)=>{for(let xx=0;xx<5;xx++)if(row[xx]==='1')pixel(x+xx,y+yy,color);});x+=6;}};
  const xAt=(time:number)=>LEFT+(time-start)/(end-start)*(RIGHT-LEFT);
  const block=(begin:number,finish:number,y:number,h:number,color:Color)=>{
    const x=Math.max(LEFT,Math.floor(xAt(begin))),right=Math.min(RIGHT,Math.ceil(xAt(finish)));if(right>x)rect(x,y,right-x,h,color);
    return {x,right};
  };
  rect(0,0,WIDTH,HEIGHT,[12,20,32]);
  // Bilinear sampling retains the shared FFT's logarithmic frequency/time lattice.
  for(let y=TOP;y<BOTTOM;y++)for(let x=LEFT;x<RIGHT;x++){
    const sx=(x-LEFT+.5)/(RIGHT-LEFT)*SPECTRUM_WIDTH-.5,sy=(y-TOP+.5)/(BOTTOM-TOP)*SPECTRUM_HEIGHT-.5;
    const x0=Math.max(0,Math.floor(sx)),x1=Math.min(SPECTRUM_WIDTH-1,x0+1),y0=Math.max(0,Math.floor(sy)),y1=Math.min(SPECTRUM_HEIGHT-1,y0+1),fx=Math.max(0,sx-x0),fy=Math.max(0,sy-y0);
    const a=spectrum[y0*SPECTRUM_WIDTH+x0]*(1-fx)+spectrum[y0*SPECTRUM_WIDTH+x1]*fx,b=spectrum[y1*SPECTRUM_WIDTH+x0]*(1-fx)+spectrum[y1*SPECTRUM_WIDTH+x1]*fx;
    const color=spectrumColor(a*(1-fy)+b*fy),time=start+(x-LEFT+.5)/(RIGHT-LEFT)*(end-start);
    const active=segments.some(s=>time>=s.begin_ms&&time<s.end_ms);
    pixel(x,y,active?color.map((v,i)=>Math.min(255,v+[3,6,6][i])) as unknown as Color:color);
  }
  const step=end-start<=2000?200:end-start<=5000?500:end-start<=10000?1000:2000;
  for(let time=Math.ceil(start/(step/2))*(step/2);time<=end;time+=step/2){
    const x=Math.round(xAt(time));
    rect(x,22,1,TOP-22,INK);
    for(let y=TOP;y<BOTTOM;y++){
      const offset=(y*WIDTH+x)*3;
      if(x<RIGHT)pixel(x,y,[pixels[offset]+(time%step===0?10:5),pixels[offset+1]+(time%step===0?10:5),pixels[offset+2]+(time%step===0?10:5)].map(v=>Math.min(255,v)) as unknown as Color);
    }
    if(time%step===0){const text=`${Number((time/1000).toFixed(3))}s`;label(text,Math.max(LEFT,Math.min(RIGHT-text.length*6,x-text.length*3)),9);}
  }
  for(const hz of [200,1000,4000]){const y=BOTTOM-1-Math.round(Math.log(hz/80)/Math.log(100)*(BOTTOM-TOP-1));label(hz===200?'0.2k':`${hz/1000}k`,3,y-3);}
  segments.forEach(s=>block(s.begin_ms,s.end_ms,BOTTOM-6,6,[69,193,166]));
  lines.forEach(line=>{const b=block(line.begin_ms,line.end_ms,197+(line.index%2)*8,8,UNIT_COLORS[(line.index-1)%4]);const text=`L${line.index}`;if(b.right-b.x>=text.length*6)label(text,b.x+2,197+(line.index%2)*8);});
  units.forEach(unit=>{
    const y=215+(unit.index%2)*23,b=block(unit.begin_ms,unit.end_ms,y,21,UNIT_COLORS[(unit.index-1)%4]);
    for(const time of [unit.begin_ms,unit.end_ms]){const x=Math.round(xAt(time));if(x>=LEFT&&x<RIGHT){rect(x,172,1,BOTTOM-172,[131,157,177]);rect(x,y,1,21,INK);}}
    const text=String(unit.index);if(b.right-b.x>=text.length*6+3)label(text,b.x+2,y+7);
  });
  ordered.flatMap(timelineReadingGaps).filter(g=>g.endMs>start&&g.beginMs<end).forEach(g=>block(g.beginMs,g.endMs,265,10,g.overlap?[211,100,131]:[99,137,174]));
  return {png:png(pixels),image_size:[WIDTH,HEIGHT],lines,units,segments_in_window:segments};
}
