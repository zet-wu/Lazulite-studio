/** The format model is deliberately DOM-free.  XML preservation belongs to the adapter. */
export type TimeUs = number | null;

export type TtmlAttribute = {
  namespaceURI: string | null;
  localName: string;
  prefix: string | null;
  name: string;
  value: string;
};

export type TtmlNode =
  | { type: 'element'; namespaceURI: string | null; localName: string; prefix: string | null; attributes: TtmlAttribute[]; children: TtmlNode[] }
  | { type: 'text'; value: string }
  | { type: 'cdata'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'processing-instruction'; target: string; value: string };

export type TtmlRuby = { base: string; reading: string; baseStart: number; baseEnd: number };
export type TtmlLine = {
  id: string | null;
  text: string;
  beginUs: TimeUs;
  endUs: TimeUs;
  agent: string | null;
  ruby: TtmlRuby[];
  sourcePath: number[];
};

export type TtmlIssue = { code: string; message: string; path?: number[] };

export type TtmlDocument = {
  rawXml: string;
  root: TtmlNode;
  lines: TtmlLine[];
  issues: TtmlIssue[];
  canEdit: boolean;
};
