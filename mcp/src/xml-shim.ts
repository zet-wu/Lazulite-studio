import {
  DOMImplementation,
  DOMParser as XmlDomParser,
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
  XMLSerializer as XmlDomSerializer,
} from '@xmldom/xmldom';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';

let installed = false;

function findFirstElement(root: XmlNode | null, predicate: (el: XmlElement) => boolean): XmlElement | null {
  if (!root) return null;
  const queue: XmlNode[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.nodeType === XmlNode.ELEMENT_NODE) {
      const element = current as XmlElement;
      if (predicate(element)) return element;
    }
    const children = current.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const child = children.item(i);
        if (child) queue.push(child);
      }
    }
  }
  return null;
}

function collectTextNodes(root: XmlNode): XmlNode[] {
  const result: XmlNode[] = [];
  const walk = (node: XmlNode) => {
    const children = node.childNodes;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      const child = children.item(i);
      if (!child) continue;
      if (child.nodeType === XmlNode.TEXT_NODE) {
        result.push(child);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return result;
}

function createErrorDocument(message: string): XmlDocument {
  const impl = new DOMImplementation();
  const doc = impl.createDocument(null, 'parsererror', null);
  if (doc.documentElement) {
    doc.documentElement.textContent = message;
  }
  return doc;
}

function querySelectorImpl(root: XmlNode | null, selector: string): XmlElement | null {
  const trimmed = selector.trim();
  if (trimmed === 'parsererror') {
    return findFirstElement(root, (el) => el.localName === 'parsererror' || el.tagName === 'parsererror');
  }
  const attrMatch = /^\[([A-Za-z_][\w.:-]*)\]$/.exec(trimmed);
  if (attrMatch) {
    const name = attrMatch[1];
    return findFirstElement(root, (el) => el.hasAttribute(name));
  }
  if (/^[A-Za-z_][\w-]*$/.test(trimmed)) {
    return findFirstElement(root, (el) => el.localName === trimmed || el.tagName === trimmed);
  }
  throw new Error(`Unsupported XML querySelector in Node shim: ${selector}`);
}

/**
 * Install pure-JS XML DOM globals required by frontend/src/adapters/ttml/lyric-codec.ts
 * and frontend/src/adapters/source-codec.ts when running in Node 22.
 */
export function installXmlDomShim(): void {
  if (installed) return;
  installed = true;

  const docProto = XmlDocument.prototype as unknown as Record<string, unknown>;
  if (typeof docProto.querySelector !== 'function') {
    docProto.querySelector = function (this: XmlDocument, selector: string) {
      return querySelectorImpl(this.documentElement, selector);
    };
  }
  if (typeof docProto.createTreeWalker !== 'function') {
    docProto.createTreeWalker = function (this: XmlDocument, root: XmlNode, whatToShow: number) {
      // lyric-codec only requests NodeFilter.SHOW_TEXT (4).
      const nodes = whatToShow === 4 ? collectTextNodes(root) : [];
      let index = -1;
      return {
        get currentNode(): XmlNode | null {
          return index >= 0 && index < nodes.length ? nodes[index] : null;
        },
        nextNode(): XmlNode | null {
          index += 1;
          return index < nodes.length ? nodes[index] : null;
        },
      };
    };
  }

  const elProto = XmlElement.prototype as unknown as Record<string, unknown>;
  if (typeof elProto.querySelector !== 'function') {
    elProto.querySelector = function (this: XmlElement, selector: string) {
      return querySelectorImpl(this, selector);
    };
  }
  if (typeof elProto.remove !== 'function') {
    elProto.remove = function (this: XmlElement) {
      this.parentNode?.removeChild(this);
    };
  }
  if (typeof elProto.closest !== 'function') {
    elProto.closest = function (this: XmlElement, selector: string): XmlElement | null {
      const normalized = selector.replace(/\\/g, '').trim();
      let current: XmlElement | null = this;
      while (current && current.nodeType === XmlNode.ELEMENT_NODE) {
        if (normalized === '[xml:space]') {
          if (current.hasAttributeNS(XML_NS, 'space') || current.hasAttribute('xml:space')) {
            return current;
          }
        } else if (current.localName === normalized || current.tagName === normalized) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    };
  }

  class ShimDOMParser {
    parseFromString(source: string, mimeType: string): XmlDocument {
      let parseErrorMessage: string | null = null;
      const parser = new XmlDomParser({
        onError: (_level, message) => {
          parseErrorMessage ??= String(message);
        },
      });
      try {
        const doc = parser.parseFromString(source, mimeType);
        if (parseErrorMessage || !doc.documentElement) {
          return createErrorDocument(parseErrorMessage ?? 'XML parse error');
        }
        return doc;
      } catch (err) {
        return createErrorDocument(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const globals = globalThis as Record<string, unknown>;
  globals.Node = XmlNode;
  globals.NodeFilter = { SHOW_TEXT: 4 };
  globals.DOMParser = ShimDOMParser;
  globals.XMLSerializer = XmlDomSerializer;
}
