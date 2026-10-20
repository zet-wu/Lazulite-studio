"""Fixed-reading prefix lookup and an optimal-path DAG; offsets are code points."""
from dataclasses import dataclass
import json
from threading import Event

import regex

from .dictionary_format import hard_boundary, read_directory


class AnalysisCancelled(Exception):
    pass


def check_cancel(cancel):
    if cancel is not None and cancel.is_set():
        raise AnalysisCancelled()


@dataclass(slots=True)
class Entry:
    cost: int
    candidates: bytes


def insert(root, surface, entry):
    """Radix edges keep one-child chains and leaf dictionaries out of memory."""
    node, remaining = root, surface
    while True:
        first = remaining[0]
        if first not in node:
            node[first] = (remaining, entry)
            return
        label, child = node[first]
        common = 0
        while common < min(len(label), len(remaining)) and label[common] == remaining[common]:
            common += 1
        if common < len(label):
            branch = {label[common]: (label[common:], child)}
            if common == len(remaining):
                branch[None] = entry
            else:
                branch[remaining[common]] = (remaining[common:], entry)
            node[first] = (label[:common], branch)
            return
        remaining = remaining[common:]
        if isinstance(child, Entry):
            child = {None: child}
            node[first] = (label, child)
        if not remaining:
            child[None] = entry
            return
        node = child


class DictionaryIndex:
    def __init__(self, directory, cancel=None):
        self.manifest, self.sources, entries = read_directory(directory)
        self.root = {}
        self.count = 0
        self.unknown = self.manifest["scoring"].get("unknownCost", 1)
        for entry in entries:
            if self.count % 1024 == 0:
                check_cancel(cancel)
            priority = max(c["priority"] for c in entry["candidates"])
            candidates = {tuple((s["base"], s["annotate"], tuple(s["units"])) for s in c["segments"])
                          for c in entry["candidates"] if c["priority"] == priority}
            # Store compact positional JSON once, rather than hundreds of
            # thousands of nested Python segment/list/string object graphs.
            packed = json.dumps(sorted(candidates), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            insert(self.root, entry["surface"], Entry(entry.get("cost", 1), packed))
            self.count += 1

    def analyze(self, text, cancel=None, *, mode="weighted", trace=None):
        n = len(text)
        if not n:
            return []
        graphemes = list(regex.finditer(r"\X", text))
        ends = {0, *(m.end() for m in graphemes)}
        edges = [[] for _ in range(n + 1)]
        unknown_cost = 1 if mode == "uniform" else self.unknown
        for number, match in enumerate(graphemes):
            if number % 256 == 0:
                check_cancel(cancel)
            start, stop = match.span()
            hard = hard_boundary(match.group())
            edges[start].append((stop, (unknown_cost, 1), None, "boundary" if hard else "unknown"))
            if hard:
                continue
            node, at = self.root, start
            while at < n and text[at] in node:
                label, child = node[text[at]]
                if not text.startswith(label, at):
                    break
                at += len(label)
                entry = child if isinstance(child, Entry) else child.get(None)
                if entry is not None and at in ends:
                    edges[start].append((at, (1 if mode == "uniform" else entry.cost, 0), entry, "known"))
                if isinstance(child, Entry):
                    break
                node = child
        if mode == "longest":
            chosen, at = [], 0
            while at < n:
                edge = max(edges[at], key=lambda e: (e[0], e[2] is not None))
                chosen.append((at, edge))
                at = edge[0]
        else:
            best = [None] * (n + 1)
            best[0] = (0, 0)
            for at in range(n):
                if best[at] is None:
                    continue
                for stop, score, _, _ in edges[at]:
                    value = (best[at][0] + score[0], best[at][1] + score[1])
                    if best[stop] is None or value < best[stop]:
                        best[stop] = value
            reachable = {n}
            chosen = []
            for at in range(n - 1, -1, -1):
                if at % 256 == 0:
                    check_cancel(cancel)
                if best[at] is None:
                    continue
                for edge in edges[at]:
                    stop, score, _, _ = edge
                    if stop in reachable and (best[at][0] + score[0], best[at][1] + score[1]) == best[stop]:
                        reachable.add(at)
                        chosen.append((at, edge))
        # Identical output segments from different best paths collapse. Overlapping
        # distinct segments form the smallest range whose mapping is uncertain.
        segments = [set() for _ in range(n)]
        decoded = {}
        for start, (stop, _, entry, state) in chosen:
            if trace is not None:
                trace.append({"start": start, "end": stop, "surface": text[start:stop], "status": state})
            if entry is None:
                segments[start].add((stop, state, ()))
            else:
                key = id(entry)
                if key not in decoded:
                    decoded[key] = json.loads(entry.candidates)
                for candidate in decoded[key]:
                    at = start
                    for base, annotate, units in candidate:
                        end = at + len(base)
                        segments[at].add((end, "known" if annotate else "unannotated", tuple(units)))
                        at = end
        output = []
        at = 0
        while at < n:
            options = [(at, *item) for item in segments[at]]
            if not options:
                raise RuntimeError("最佳路径没有覆盖正文")
            end = max(o[1] for o in options)
            cursor = at + 1
            while cursor < end:
                for item in segments[cursor]:
                    options.append((cursor, *item))
                    end = max(end, item[0])
                cursor += 1
            state, units = ("ambiguous", ()) if len(options) > 1 else (options[0][2], options[0][3])
            output.append({"base_start": at, "base_end": end, "base": text[at:end],
                           "status": state, "units": list(units)})
            at = end
        return output

    def snapshot(self, lines, cancel=None):
        if len({line["id"] for line in lines}) != len(lines):
            raise ValueError("行标识重复")
        if sum(len(line["text"]) for line in lines) > 1_000_000:
            raise ValueError("本次正文过长，请减少所选行")
        result = []
        for line in lines:
            check_cancel(cancel)
            result.extend({"line_id": line["id"], **r} for r in self.analyze(line["text"], cancel))
        return result
