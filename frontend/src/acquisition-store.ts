import { SourceError, sourceRequest, type Candidate, type Source, parsePayload, type Payload } from './adapters/http/lyric-sources';
import { identityScore, titleVariants } from './domain/lyric-search';
import type { LyricDocument } from './domain/lyric-document';
import type { SearchConditions } from './features/useSearchConditions';
export const SOURCES: Source[] = ['netease','qqmusic','kugou','amll'];
export type CheckStatus = 'pending' | 'fetching' | 'parsing' | 'ready' | 'partial' | 'fetch-failed' | 'decode-failed' | 'parse-failed' | 'empty';
export type CandidateRecord = { candidate: Candidate; score: number; badges: string[]; status: CheckStatus; error?: string };
export type SourceState = { rows: string[]; records: Record<string,CandidateRecord>; selected: string | null; pending: number; succeeded: number; failed: string[]; cancelled: boolean };
export type AcquisitionState = { round: number; query: SearchConditions | null; tab: Source | 'file' | 'text'; sources: Record<Source,SourceState>; version: number };
type Task = { source: Source; kind: 'search' | 'check'; id?: string; round: number; controller: AbortController; run: () => Promise<void> };
const freshSource = (): SourceState => ({ rows: [], records: {}, selected: null, pending: 0, succeeded: 0, failed: [], cancelled: false });
const freshSources = () => Object.fromEntries(SOURCES.map(source=>[source,freshSource()])) as Record<Source,SourceState>;
export const PREVIEW_CAPACITY = 8; // Includes at most four pinned selections.
export class AcquisitionStore {
  private state: AcquisitionState = { round: 0, query: null, tab: 'file', sources: freshSources(), version: 0 };
  private listeners = new Set<() => void>();
  private tasks: Task[] = [];
  private active = new Set<Task>();
  private cache = new Map<string,LyricDocument>();
  private interaction = new Set<Source>();
  private disposed = false;
  constructor(private request = sourceRequest) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.state = { ...this.state, version: this.state.version+1 }; for (const listener of this.listeners) listener(); }
  private source(source: Source) { return this.state.sources[source]; }
  private cacheKey(source: Source, id: string) { return `${source}:${id}`; }
  preview(source: Source) { const id = this.source(source).selected; return id ? this.cache.get(this.cacheKey(source,id)) ?? null : null; }
  get cacheSize() { return this.cache.size; }
  setTab(tab: AcquisitionState['tab']) { this.state.tab = tab; this.emit(); this.pump(); }
  setInteracting(source: Source, active: boolean) {
    if (active) this.interaction.add(source);
    else { this.interaction.delete(source); this.sort(source); this.emit(); }
  }
  private sort(source: Source) {
    if (!this.state.query || this.interaction.has(source)) return;
    const rows = this.source(source);
    rows.rows.sort((a,b)=>rows.records[b].score-rows.records[a].score || (a < b ? -1 : a > b ? 1 : 0));
  }
  search(query: SearchConditions) {
    this.cancelAll(); this.cache.clear();
    this.state = { ...this.state, round: this.state.round+1, query: { ...query }, sources: freshSources() };
    const variants = titleVariants(query.title);
    for (const source of SOURCES) this.queueSearch(source,variants);
    this.emit(); this.pump();
  }
  ensureSearch(query: SearchConditions) { if (!this.state.query && query.title.trim()) this.search(query); }
  retrySearch(source: Source) { const failed = this.source(source).failed; this.source(source).failed = []; this.queueSearch(source,failed); this.emit(); this.pump(); }
  private queueSearch(source: Source, queries: string[]) {
    const state = this.source(source); state.cancelled = false; state.pending += queries.length;
    for (const query of queries) {
      const round = this.state.round, controller = new AbortController();
      const task: Task = { source, kind: 'search', round, controller, run: async () => {
        try {
          const result = await this.request<{items: Candidate[]}>('search',{ source, query },controller.signal);
          if (!this.valid(task)) return;
          for (const candidate of result.items) {
            if (candidate.source !== source) throw new Error('来源响应不一致');
            const existing = state.records[candidate.id];
            if (existing) {
              existing.candidate = { ...existing.candidate, ...candidate, songmid: candidate.songmid ?? existing.candidate.songmid };
              existing.score = identityScore(this.state.query!,existing.candidate);
            } else { state.rows.push(candidate.id); state.records[candidate.id] = { candidate, score: identityScore(this.state.query!,candidate), badges: [], status: 'pending' }; this.queueCheck(source,candidate.id); }
          }
          ++state.succeeded; this.sort(source);
        } catch { if (this.valid(task)) state.failed.push(query); }
        finally { if (this.valid(task)) { --state.pending; this.emit(); } }
      }};
      this.tasks.push(task);
    }
  }
  private valid(task: Task) { return !this.disposed && task.round === this.state.round && !task.controller.signal.aborted; }
  cancelSearch() {
    for (const source of SOURCES) { this.source(source).pending = 0; this.source(source).cancelled = true; }
    this.tasks = this.tasks.filter(task=>task.kind !== 'search');
    for (const task of this.active) if (task.kind === 'search') task.controller.abort();
    this.emit(); this.pump();
  }
  cancelAll() {
    this.tasks = []; for (const task of this.active) task.controller.abort();
    for (const source of SOURCES) { this.source(source).pending = 0; this.source(source).cancelled = true; }
  }
  activate() { this.disposed = false; }
  dispose() { this.disposed = true; this.cancelAll(); this.listeners.clear(); this.cache.clear(); }
  select(source: Source, id: string) {
    const state = this.source(source); state.selected = id;
    const key = this.cacheKey(source,id), cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key,cached); }
    else this.queueCheck(source,id);
    this.emit(); this.pump();
  }
  refresh(source: Source, id: string) {
    if (this.hasCheck(source,id)) return;
    this.cache.delete(this.cacheKey(source,id)); this.queueCheck(source,id); this.emit(); this.pump();
  }
  private hasCheck(source: Source, id: string) { return [...this.tasks,...this.active].some(task=>task.kind === 'check' && task.source === source && task.id === id && this.valid(task)); }
  private queueCheck(source: Source, id: string) {
    if (this.hasCheck(source,id)) return;
    const state = this.source(source), record = state.records[id]; record.status = 'pending'; record.error = undefined;
    const controller = new AbortController(), round = this.state.round;
    const task: Task = { source, id, kind: 'check', round, controller, run: async () => {
      let parsing = false;
      try {
        record.status = 'fetching'; this.emit();
        let candidate = record.candidate;
        if (source === 'qqmusic' && !candidate.songmid) {
          try {
            candidate = await this.request<Candidate>('resolve',candidate,controller.signal);
            if (!this.valid(task)) return;
            record.candidate = candidate;
          } catch (e) {
            if (!this.valid(task)) return;
            record.error = '歌曲 ID 补查失败，可继续取词或重试';
          }
        }
        const payload = await this.request<Payload>('fetch',candidate,controller.signal);
        if (!this.valid(task)) return;
        if (payload.empty) { record.status = 'empty'; record.error = '此候选没有可用歌词，仍可关联已确认的歌曲 ID'; return; }
        parsing = true; record.status = 'parsing'; this.emit();
        const parsed = parsePayload(payload);
        record.badges = parsed.badges; record.status = parsed.partial ? 'partial' : 'ready';
        this.cacheDocument(source,id,parsed.document);
      } catch (e) {
        if (this.valid(task)) { record.status = parsing ? 'parse-failed' : e instanceof SourceError && e.code === 'source_decode' ? 'decode-failed' : 'fetch-failed'; record.error = e instanceof Error ? e.message : '请求失败'; }
      } finally { if (this.valid(task)) this.emit(); }
    }};
    this.tasks.push(task);
  }
  private cacheDocument(source: Source, id: string, document: LyricDocument) {
    const key = this.cacheKey(source,id); this.cache.delete(key); this.cache.set(key,document);
    const pinned = new Set(SOURCES.flatMap(s=>this.source(s).selected ? [this.cacheKey(s,this.source(s).selected!)] : []));
    for (const cached of this.cache.keys()) {
      if (this.cache.size <= PREVIEW_CAPACITY) break;
      if (!pinned.has(cached)) this.cache.delete(cached);
    }
  }
  private pump() {
    if (this.disposed) return;
    while (true) {
      const checks = [...this.active].filter(task=>task.kind === 'check').length;
      const eligible = this.tasks.filter(task=>[...this.active].filter(t=>t.source === task.source).length < 3 && (task.kind !== 'check' || checks < 2));
      const priority = (task: Task) => task.kind === 'search' ? 2 : this.source(task.source).selected === task.id ? 0 : task.source === this.state.tab ? 1 : 3;
      eligible.sort((a,b)=>priority(a)-priority(b));
      const task = eligible[0]; if (!task) break;
      this.tasks.splice(this.tasks.indexOf(task),1); this.active.add(task);
      void task.run().finally(()=>{ this.active.delete(task); this.pump(); });
    }
  }
}
