export const SPECTRUM_CACHE_LIMIT = 128;
export type SpectrumTile = {
  startMs: number;
  endMs: number;
  pixels: Uint8Array;
  bitmap?: HTMLCanvasElement;
};

function releaseTile(tile: SpectrumTile | undefined) {
  if (tile?.bitmap) {
    tile.bitmap.width = 0;
    tile.bitmap.height = 0;
    tile.bitmap = undefined;
  }
}

/** Intensity tiles with cached colored bitmaps; project/asset/algorithm identity belongs to the owner. */
export class SpectrumCache {
  private tiles = new Map<number, SpectrumTile>();
  evictions?: number;
  constructor(diagnostics = false) { if (diagnostics) this.evictions = 0; }
  get size() { return this.tiles.size; }
  get(startMs: number) {
    const tile = this.tiles.get(startMs);
    if (tile) { this.tiles.delete(startMs); this.tiles.set(startMs, tile); }
    return tile;
  }
  set(tile: SpectrumTile) {
    const existing = this.tiles.get(tile.startMs);
    if (existing && existing !== tile) releaseTile(existing);
    this.tiles.delete(tile.startMs); this.tiles.set(tile.startMs, tile);
    if (this.tiles.size > SPECTRUM_CACHE_LIMIT) {
      const oldestKey = this.tiles.keys().next().value!;
      releaseTile(this.tiles.get(oldestKey));
      this.tiles.delete(oldestKey);
      if (this.evictions !== undefined) this.evictions++;
    }
  }
  clear() {
    for (const tile of this.tiles.values()) releaseTile(tile);
    this.tiles.clear();
  }
}
