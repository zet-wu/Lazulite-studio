import type { StudioLine } from "../../domain/document";

function elementAt(root: Element, path: number[]) {
  let current = root;
  for (const index of path) {
    const child = current.children[index];
    if (!child) return null;
    current = child;
  }
  return current;
}
export function snapshotLineElements(
  root: Element,
  baselineLines: StudioLine[],
): Map<string, Element> {
  const result = new Map<string, Element>();
  for (const line of baselineLines) {
    const element = elementAt(root, line.sourcePath);
    if (element) result.set(line.id, element);
  }
  return result;
}
