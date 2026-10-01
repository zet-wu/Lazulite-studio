export const SPECTRUM_CACHE_LIMIT = 128;
export type SpectrumTile = { startMs: number; endMs: number; pixels: Uint8Array };

/** Intensity tiles only; project/asset/algorithm identity belongs to the owner. */
export class SpectrumCache {
  private tiles = new Map<number, SpectrumTile>();
  evictions = 0;
  get size() { return this.tiles.size; }
  get(startMs: number) {
    const tile = this.tiles.get(startMs);
    if (tile) { this.tiles.delete(startMs); this.tiles.set(startMs, tile); }
    return tile;
  }
  set(tile: SpectrumTile) {
    this.tiles.delete(tile.startMs); this.tiles.set(tile.startMs, tile);
    if (this.tiles.size > SPECTRUM_CACHE_LIMIT) { this.tiles.delete(this.tiles.keys().next().value!); this.evictions++; }
  }
}
