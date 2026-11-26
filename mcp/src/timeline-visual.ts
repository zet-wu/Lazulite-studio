import { deflateSync } from 'node:zlib';
import { computeSpectrogram, SPECTRUM_WIDTH, SPECTRUM_HEIGHT } from '../../frontend/src/domain/spectrogram';
import { visibleEnergy, type EnergyWindow } from '../../frontend/src/domain/energy-window';
import { displayLines } from '../../frontend/src/domain/amll-compatibility';
import { timeEnvelope } from '../../frontend/src/domain/lyric-commands';
import { readingLeaves } from '../../frontend/src/domain/reading-units';
import { timelineReadingGaps } from '../../frontend/src/domain/timeline-editing';
import type { ProjectDocument } from '../../frontend/src/domain/project-document';
import { StudioHttpError } from './client';

export const VISUAL_PLOT_WIDTH = 792;
const WIDTH = 840, LEFT = 40, RIGHT = LEFT + VISUAL_PLOT_WIDTH;
const ENERGY_HEIGHT = 48, ENERGY_GAP = 2;
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
function encodePng(pixels:Buffer,width:number,height:number):Buffer {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc((width*3+1)*height);
  // PNG Sub filtering compresses smooth spectrogram gradients before deflate.
  for(let y=0;y<height;y++){
    const row=y*(width*3+1);rows[row]=1;
    for(let x=0;x<width*3;x++)rows[row+1+x]=(pixels[y*width*3+x]-(x>=3?pixels[y*width*3+x-3]:0))&255;
  }
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
 'A':['01110','10001','10001','11111','10001','10001','10001'],
 'B':['11110','10001','10001','11110','10001','10001','11110'],
 'C':['01110','10001','10000','10000','10000','10001','01110'],
 'D':['11110','10001','10001','10001','10001','10001','11110'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],
 'F':['11111','10000','10000','11110','10000','10000','10000'],
 'I':['01110','00100','00100','00100','00100','00100','01110'],
 'L':['10000','10000','10000','10000','10000','10000','11111'],
 'M':['10001','11011','10101','10101','10001','10001','10001'],
 'R':['11110','10001','10001','11110','10100','10010','10001'],
 'S':['01111','10000','10000','01110','00001','00001','11110'],
 'U':['10001','10001','10001','10001','10001','10001','01110'],
};
type Color=readonly[number,number,number];
const BG:Color=[12,20,32], INK:Color=[218,235,248], MUTED_INK:Color=[140,162,182];
const PALETTE:Color[]=[[11,19,43],[21,63,110],[20,167,182],[230,207,86],[255,252,223]];
const UNIT_COLORS:Color[]=[[39,117,152],[103,77,148],[39,133,111],[153,97,53]];
const OUT_OF_SCOPE_FILL:Color=[36,46,58], OUT_OF_SCOPE_BORDER:Color=[82,98,114];
const ENERGY_BG:Color=[15,26,40], ENERGY_FILL:Color=[24,66,74], ENERGY_LINE:Color=[94,224,196];
const DIVERGENT_COLOR:Color=[238,118,74], DIVERGENT_LINE:Color=[232,126,84];

function spectrumColor(value:number):Color {
  const position=value/255*(PALETTE.length-1),index=Math.min(PALETTE.length-2,Math.floor(position)),f=position-index;
  return PALETTE[index].map((v,i)=>Math.round(v*(1-f)+PALETTE[index+1][i]*f)) as unknown as Color;
}

function createCanvas(height:number,[start,end]:[number,number]) {
  const pixels=Buffer.alloc(WIDTH*height*3);
  const pixel=(x:number,y:number,color:Color)=>{
    const xi=Math.floor(x),yi=Math.floor(y);
    if(xi<0||xi>=WIDTH||yi<0||yi>=height)return;
    const i=(yi*WIDTH+xi)*3;pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];
  };
  const rect=(x:number,y:number,w:number,h:number,color:Color)=>{
    for(let yy=Math.max(0,Math.floor(y));yy<Math.min(height,y+h);yy++)
      for(let xx=Math.max(0,Math.floor(x));xx<Math.min(WIDTH,x+w);xx++)pixel(xx,yy,color);
  };
  const line=(x0:number,y0:number,x1:number,y1:number,color:Color)=>{
    let ax=Math.round(x0),ay=Math.round(y0),bx=Math.round(x1),by=Math.round(y1);
    const dx=Math.abs(bx-ax),dy=Math.abs(by-ay),sx=ax<bx?1:-1,sy=ay<by?1:-1;
    let err=dx-dy;
    for(;;){
      pixel(ax,ay,color);
      if(ax===bx&&ay===by)break;
      const e2=2*err;
      if(e2>-dy){err-=dy;ax+=sx;}
      if(e2<dx){err+=dx;ay+=sy;}
    }
  };
  const label=(text:string,x:number,y:number,color:Color=INK)=>{
    for(const char of text){const glyph=GLYPHS[char];glyph?.forEach((row,yy)=>{for(let xx=0;xx<5;xx++)if(row[xx]==='1')pixel(x+xx,y+yy,color);});x+=6;}
  };
  const xAt=(time:number)=>LEFT+(time-start)/(end-start)*(RIGHT-LEFT);
  const block=(begin:number,finish:number,y:number,h:number,color:Color)=>{
    const x=Math.max(LEFT,Math.floor(xAt(begin))),right=Math.min(RIGHT,Math.ceil(xAt(finish)));
    if(right>x)rect(x,y,right-x,h,color);
    return {x,right};
  };
  const brightenColumn=(x:number,top:number,bottom:number,delta:number)=>{
    if(x<LEFT||x>=RIGHT)return;
    for(let y=top;y<bottom;y++){
      const offset=(y*WIDTH+x)*3;
      pixel(x,y,[Math.min(255,pixels[offset]+delta),Math.min(255,pixels[offset+1]+delta),Math.min(255,pixels[offset+2]+delta)]);
    }
  };
  rect(0,0,WIDTH,height,BG);
  return {pixels,pixel,rect,line,label,xAt,block,brightenColumn,toPng:()=>encodePng(pixels,WIDTH,height)};
}

type Canvas = ReturnType<typeof createCanvas>;
type VisibleSegment = { segment_id: string; begin_ms: number; end_ms: number };
export type EnergyRenderSummary = { included: boolean; upper_rms?: number; step_ms?: number; sample_count?: number };

function drawEnergyTrack(canvas:Canvas,view:NonNullable<ReturnType<typeof visibleEnergy>>,top:number,height:number) {
  canvas.rect(LEFT,top,RIGHT-LEFT,height,ENERGY_BG);
  canvas.rect(LEFT,top+height-1,RIGHT-LEFT,1,[34,54,72]);
  canvas.label('RMS',3,top+Math.floor((height-7)/2),ENERGY_LINE);
  const bottom=top+height-2,scale=height-4;
  let prev:readonly[number,number]|null=null;
  for(let i=0;i<view.values.length;i++){
    const x=Math.max(LEFT,Math.min(RIGHT-1,Math.round(canvas.xAt(view.start_ms+i*view.step_ms))));
    const y=Math.max(top+1,Math.min(bottom,Math.round(bottom-view.values[i]/view.upper*scale)));
    if(bottom>y)canvas.rect(x,y,1,bottom-y,ENERGY_FILL);
    if(prev)canvas.line(prev[0],prev[1],x,y,ENERGY_LINE);
    else canvas.pixel(x,y,ENERGY_LINE);
    prev=[x,y];
  }
}

function drawSpectrogramAndRuler(
  canvas:Canvas,
  pcm:Int16Array,
  segments:VisibleSegment[],
  [start,end]:[number,number],
  specTop:number,
  specBottom:number,
  gridTop:number,
) {
  const spectrum=computeSpectrogram(pcm,16000,1);
  // Bilinear sampling retains the shared FFT's logarithmic frequency/time lattice.
  for(let y=specTop;y<specBottom;y++)for(let x=LEFT;x<RIGHT;x++){
    const sx=(x-LEFT+.5)/(RIGHT-LEFT)*SPECTRUM_WIDTH-.5,sy=(y-specTop+.5)/(specBottom-specTop)*SPECTRUM_HEIGHT-.5;
    const x0=Math.max(0,Math.floor(sx)),x1=Math.min(SPECTRUM_WIDTH-1,x0+1),y0=Math.max(0,Math.floor(sy)),y1=Math.min(SPECTRUM_HEIGHT-1,y0+1),fx=Math.max(0,sx-x0),fy=Math.max(0,sy-y0);
    const a=spectrum[y0*SPECTRUM_WIDTH+x0]*(1-fx)+spectrum[y0*SPECTRUM_WIDTH+x1]*fx,b=spectrum[y1*SPECTRUM_WIDTH+x0]*(1-fx)+spectrum[y1*SPECTRUM_WIDTH+x1]*fx;
    const color=spectrumColor(a*(1-fy)+b*fy),time=start+(x-LEFT+.5)/(RIGHT-LEFT)*(end-start);
    const active=segments.some(s=>time>=s.begin_ms&&time<s.end_ms);
    canvas.pixel(x,y,active?[Math.min(255,color[0]+3),Math.min(255,color[1]+6),Math.min(255,color[2]+6)]:color);
  }
  const step=end-start<=2000?200:end-start<=5000?500:end-start<=10000?1000:2000;
  for(let time=Math.ceil(start/(step/2))*(step/2);time<=end;time+=step/2){
    const x=Math.round(canvas.xAt(time));
    canvas.rect(x,22,1,6,INK);
    canvas.brightenColumn(x,gridTop,specBottom,time%step===0?10:5);
    if(time%step===0){const text=`${Number((time/1000).toFixed(3))}s`;canvas.label(text,Math.max(LEFT,Math.min(RIGHT-text.length*6,x-text.length*3)),9);}
  }
  for(const hz of [200,1000,4000]){const y=specBottom-1-Math.round(Math.log(hz/80)/Math.log(100)*(specBottom-specTop-1));canvas.label(hz===200?'0.2k':`${hz/1000}k`,3,y-3);}
  segments.forEach(s=>canvas.block(s.begin_ms,s.end_ms,specBottom-6,6,[69,193,166]));
}

export function renderTimelineVisual(bytes:Buffer,doc:ProjectDocument,range:[number,number],energy?:EnergyWindow|null) {
  const pcm=excerptPcm(bytes),[start,end]=range;
  const energyView=energy?visibleEnergy(energy,start,end):null;
  const specTop=energyView?28+ENERGY_HEIGHT+ENERGY_GAP:28;
  const specBottom=specTop+168;
  const height=specBottom+84;
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
  const canvas=createCanvas(height,range);
  if(energyView)drawEnergyTrack(canvas,energyView,28,ENERGY_HEIGHT);
  drawSpectrogramAndRuler(canvas,pcm,segments,range,specTop,specBottom,28);
  lines.forEach(line=>{const b=canvas.block(line.begin_ms,line.end_ms,specBottom+1+(line.index%2)*8,8,UNIT_COLORS[(line.index-1)%4]);const text=`L${line.index}`;if(b.right-b.x>=text.length*6)canvas.label(text,b.x+2,specBottom+1+(line.index%2)*8);});
  units.forEach(unit=>{
    const y=specBottom+19+(unit.index%2)*23,b=canvas.block(unit.begin_ms,unit.end_ms,y,21,UNIT_COLORS[(unit.index-1)%4]);
    for(const time of [unit.begin_ms,unit.end_ms]){const x=Math.round(canvas.xAt(time));if(x>=LEFT&&x<RIGHT){canvas.rect(x,specBottom-24,1,24,[131,157,177]);canvas.rect(x,y,1,21,INK);}}
    const text=String(unit.index);if(b.right-b.x>=text.length*6+3)canvas.label(text,b.x+2,y+7);
  });
  ordered.flatMap(timelineReadingGaps).filter(g=>g.endMs>start&&g.beginMs<end).forEach(g=>canvas.block(g.beginMs,g.endMs,specBottom+69,10,g.overlap?[211,100,131]:[99,137,174]));
  const energySummary:EnergyRenderSummary=energyView
    ? {included:true,upper_rms:energyView.upper,step_ms:energyView.step_ms,sample_count:energyView.values.length}
    : {included:false};
  return {png:canvas.toPng(),image_size:[WIDTH,height] as [number,number],lines,units,segments_in_window:segments,energy:energySummary};
}

export type ComparisonCandidateInput = {
  label: 'A' | 'B';
  jobId: string;
  modelName: string | null;
  doc: ProjectDocument;
  scopeIds: Set<string>;
};

type UnitTiming = { begin_ms: number | null; end_ms: number | null; duration_ms: number | null };
function unitTiming(beginMs:number|null,endMs:number|null):UnitTiming {
  return {begin_ms:beginMs,end_ms:endMs,duration_ms:beginMs!==null&&endMs!==null?endMs-beginMs:null};
}

export function renderComparisonVisual(
  bytes:Buffer,
  savedDoc:ProjectDocument,
  candidates:ComparisonCandidateInput[],
  range:[number,number],
  options:{energy?:EnergyWindow|null;divergenceThresholdMs:number},
) {
  const pcm=excerptPcm(bytes),[start,end]=range;
  const energyView=options.energy?visibleEnergy(options.energy,start,end):null;
  const specTop=energyView?28+ENERGY_HEIGHT+ENERGY_GAP:28;
  const specHeight=152,specBottom=specTop+specHeight;
  const lineTop=specBottom+2,trackHeight=38,trackGap=4,diffHeight=14;
  const tracksTop=lineTop+18;
  const trackCount=1+candidates.length;
  const diffTop=tracksTop+trackCount*(trackHeight+trackGap)+2;
  const height=diffTop+diffHeight+8;

  const visible=(begin:number|null,finish:number|null)=>begin!==null&&finish!==null&&finish>start&&begin<end;
  const ordered=displayLines(savedDoc.lyrics,savedDoc.lineOrder);
  const candidateMaps=candidates.map(candidate=>{
    const map=new Map<string,{beginMs:number|null;endMs:number|null}>();
    for(const line of displayLines(candidate.doc.lyrics,candidate.doc.lineOrder)){
      for(const leaf of readingLeaves(line))map.set(leaf.value.id,{beginMs:leaf.value.beginMs,endMs:leaf.value.endMs});
    }
    return map;
  });

  const lines=ordered.flatMap((line,ordinal)=>{
    const span=timeEnvelope([line,...line.words,...line.words.flatMap(word=>word.rubyUnits)]);
    return visible(span.beginMs,span.endMs)?[{index:0,line_id:line.id,line_number:ordinal+1,begin_ms:span.beginMs!,end_ms:span.endMs!}]:[];
  }).map((line,index)=>({...line,index:index+1}));

  type CandidateUnitEntry = UnitTiming & { in_scope: boolean; delta_begin_ms: number | null; delta_end_ms: number | null };
  const units=ordered.flatMap(line=>readingLeaves(line).flatMap(leaf=>{
    const saved=unitTiming(leaf.value.beginMs,leaf.value.endMs);
    const perCandidate:Record<string,CandidateUnitEntry>={};
    let anyVisible=visible(saved.begin_ms,saved.end_ms);
    candidates.forEach((candidate,idx)=>{
      const found=candidateMaps[idx].get(leaf.value.id)??{beginMs:null,endMs:null};
      const timing=unitTiming(found.beginMs,found.endMs);
      if(visible(timing.begin_ms,timing.end_ms))anyVisible=true;
      perCandidate[candidate.label]={
        in_scope:candidate.scopeIds.has(leaf.value.id),
        ...timing,
        delta_begin_ms:timing.begin_ms!==null&&saved.begin_ms!==null?timing.begin_ms-saved.begin_ms:null,
        delta_end_ms:timing.end_ms!==null&&saved.end_ms!==null?timing.end_ms-saved.end_ms:null,
      };
    });
    if(!anyVisible)return [];

    // Compare current_saved against in-scope candidates, and candidates against each other.
    const beginValues:number[]=[];
    const endValues:number[]=[];
    if(saved.begin_ms!==null)beginValues.push(saved.begin_ms);
    if(saved.end_ms!==null)endValues.push(saved.end_ms);
    let hasInScopeCandidate=false;
    for(const candidate of candidates){
      const entry=perCandidate[candidate.label];
      if(!entry.in_scope)continue;
      hasInScopeCandidate=true;
      if(entry.begin_ms!==null)beginValues.push(entry.begin_ms);
      if(entry.end_ms!==null)endValues.push(entry.end_ms);
    }
    const maxBeginDiff=hasInScopeCandidate&&beginValues.length>=2?Math.max(...beginValues)-Math.min(...beginValues):0;
    const maxEndDiff=hasInScopeCandidate&&endValues.length>=2?Math.max(...endValues)-Math.min(...endValues):0;
    const maxDivergence=Math.max(maxBeginDiff,maxEndDiff);
    let pairDelta:{begin_diff_ms:number|null;end_diff_ms:number|null;max_abs_diff_ms:number|null}|undefined;
    if(candidates.length===2){
      const a=perCandidate.A,b=perCandidate.B;
      const bd=a.begin_ms!==null&&b.begin_ms!==null?b.begin_ms-a.begin_ms:null;
      const ed=a.end_ms!==null&&b.end_ms!==null?b.end_ms-a.end_ms:null;
      const abs=[bd,ed].filter((v):v is number=>v!==null).map(Math.abs);
      pairDelta={begin_diff_ms:bd,end_diff_ms:ed,max_abs_diff_ms:abs.length?Math.max(...abs):null};
    }
    return [{
      index:0,
      unit_id:leaf.value.id,
      word_id:line.words[leaf.wordIndex].id,
      line_id:line.id,
      kind:leaf.rubyIndex===null?'word' as const:'ruby' as const,
      text:leaf.text,
      current_saved:saved,
      candidates:perCandidate,
      ...(pairDelta?{pair_delta:pairDelta}:{}),
      max_divergence_ms:maxDivergence,
      divergent:hasInScopeCandidate&&maxDivergence>=options.divergenceThresholdMs,
      _divergentBegin:hasInScopeCandidate&&maxBeginDiff>=options.divergenceThresholdMs,
      _divergentEnd:hasInScopeCandidate&&maxEndDiff>=options.divergenceThresholdMs,
    }];
  })).map((unit,index)=>({...unit,index:index+1}));

  const segments=savedDoc.acoustics.segments.filter(s=>visible(s.beginMs,s.endMs)).map(s=>({segment_id:s.id,begin_ms:s.beginMs,end_ms:s.endMs}));
  const canvas=createCanvas(height,range);
  if(energyView)drawEnergyTrack(canvas,energyView,28,ENERGY_HEIGHT);
  drawSpectrogramAndRuler(canvas,pcm,segments,range,specTop,specBottom,28);

  lines.forEach(line=>{
    const b=canvas.block(line.begin_ms,line.end_ms,lineTop+(line.index%2)*8,8,UNIT_COLORS[(line.index-1)%4]);
    const text=`L${line.index}`;
    if(b.right-b.x>=text.length*6)canvas.label(text,b.x+2,lineTop+(line.index%2)*8);
  });

  const drawUnitTrack=(trackIndex:number,trackLabel:string,getTiming:(u:typeof units[number])=>{begin_ms:number|null;end_ms:number|null;in_scope:boolean})=>{
    const y0=tracksTop+trackIndex*(trackHeight+trackGap);
    canvas.rect(LEFT,y0,RIGHT-LEFT,trackHeight,[16,25,38]);
    canvas.label(trackLabel,3,y0+Math.floor((trackHeight-7)/2),trackIndex===0?INK:MUTED_INK);
    units.forEach(unit=>{
      const t=getTiming(unit);
      if(!visible(t.begin_ms,t.end_ms))return;
      const rowY=y0+1+(unit.index%2)*19;
      const fill=t.in_scope?UNIT_COLORS[(unit.index-1)%4]:OUT_OF_SCOPE_FILL;
      const border=t.in_scope?INK:OUT_OF_SCOPE_BORDER;
      const b=canvas.block(t.begin_ms!,t.end_ms!,rowY,17,fill);
      for(const time of [t.begin_ms!,t.end_ms!]){
        const x=Math.round(canvas.xAt(time));
        if(x>=LEFT&&x<RIGHT)canvas.rect(x,rowY,1,17,border);
      }
      const text=String(unit.index);
      if(b.right-b.x>=text.length*6+3)canvas.label(text,b.x+2,rowY+5,t.in_scope?INK:MUTED_INK);
    });
  };

  drawUnitTrack(0,'CUR',u=>({...u.current_saved,in_scope:true}));
  candidates.forEach((candidate,idx)=>drawUnitTrack(idx+1,candidate.label,u=>u.candidates[candidate.label]));

  // Divergence bar & vertical guide ticks at divergent boundaries.
  canvas.rect(LEFT,diffTop,RIGHT-LEFT,diffHeight,[18,26,38]);
  canvas.label('DIF',3,diffTop+3,DIVERGENT_COLOR);
  for(const unit of units){
    if(!unit.divergent)continue;
    const allBegins=[unit.current_saved.begin_ms,...candidates.filter(c=>unit.candidates[c.label].in_scope).map(c=>unit.candidates[c.label].begin_ms)].filter((v):v is number=>v!==null);
    const allEnds=[unit.current_saved.end_ms,...candidates.filter(c=>unit.candidates[c.label].in_scope).map(c=>unit.candidates[c.label].end_ms)].filter((v):v is number=>v!==null);
    if(allBegins.length&&allEnds.length){
      const spanBegin=Math.min(...allBegins),spanEnd=Math.max(...allEnds);
      const b=canvas.block(spanBegin,spanEnd,diffTop+2,diffHeight-4,DIVERGENT_COLOR);
      const text=String(unit.index);
      if(b.right-b.x>=text.length*6+2)canvas.label(text,b.x+2,diffTop+3,BG);
    }
    const markBoundary=(times:number[])=>{
      for(const t of times){
        const x=Math.round(canvas.xAt(t));
        if(x>=LEFT&&x<RIGHT){
          canvas.rect(x,specBottom-18,1,18,DIVERGENT_LINE);
          canvas.rect(x,diffTop,1,diffHeight,DIVERGENT_COLOR);
        }
      }
    };
    if(unit._divergentBegin)markBoundary(allBegins);
    if(unit._divergentEnd)markBoundary(allEnds);
  }

  const publicUnits=units.map(({_divergentBegin,_divergentEnd,...rest})=>rest);
  const energySummary:EnergyRenderSummary=energyView
    ? {included:true,upper_rms:energyView.upper,step_ms:energyView.step_ms,sample_count:energyView.values.length}
    : {included:false};
  return {
    png:canvas.toPng(),
    image_size:[WIDTH,height] as [number,number],
    divergence_threshold_ms:options.divergenceThresholdMs,
    tracks:[
      {id:'current_saved',label:'CUR',name:'current_saved_timeline'},
      ...candidates.map(c=>({id:c.label,label:c.label,job_id:c.jobId,model_name:c.modelName})),
    ],
    lines,
    units:publicUnits,
    divergent_unit_indices:publicUnits.filter(u=>u.divergent).map(u=>u.index),
    segments_in_window:segments,
    energy:energySummary,
  };
}
