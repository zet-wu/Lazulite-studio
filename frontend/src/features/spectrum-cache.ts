export const SPECTRUM_CACHE_LIMIT = 128;
export type SpectrumTile = { startUs: number; endUs: number; pixels: Uint8Array };

/** Intensity tiles only; project/asset/algorithm identity belongs to the owner. */
export class SpectrumCache {
  private tiles = new Map<number, SpectrumTile>();
  evictions = 0;
  get size() { return this.tiles.size; }
  get(startUs: number) {
    const tile = this.tiles.get(startUs);
    if (tile) { this.tiles.delete(startUs); this.tiles.set(startUs, tile); }
    return tile;
  }
  set(tile: SpectrumTile) {
    this.tiles.delete(tile.startUs); this.tiles.set(tile.startUs, tile);
    if (this.tiles.size > SPECTRUM_CACHE_LIMIT) { this.tiles.delete(this.tiles.keys().next().value!); this.evictions++; }
  }
}
