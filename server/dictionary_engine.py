"""Fixed-reading prefix lookup and an optimal-path DAG; offsets are code points."""

import regex

from .dictionary_format import hard_boundary, read_directory


class AnalysisCancelled(Exception):
    pass


def check_cancel(cancel):
    if cancel is not None and cancel.is_set():
        raise AnalysisCancelled()


class DictionaryIndex:
    def __init__(self, directory, cancel=None, *, installed=False):
        self.manifest, self.sources, entries = read_directory(directory, installed=installed)
        self.entries = {}
        self.max_len = {}
        self.alternatives = {}
        self.count = 0
        self.unknown = self.manifest["scoring"].get("unknownCost", 1)
        segment_pool = {}
        def pack_segments(segments):
            result = []
            for segment in segments:
                value = (segment.base, segment.annotate, segment.units)
                stored = segment_pool.get(value)
                if stored is None:
                    if not segment.base.strip() or '\x00' in segment.base or bool(segment.units) != segment.annotate or any(not unit.strip() or '\x00' in unit for unit in segment.units):
                        raise ValueError("正文对应段或读音单元无效")
                    segment_pool[value] = value
                    stored = value
                result.append(stored)
            return tuple(result)
        for entry in entries:
            if self.count % 1024 == 0:
                check_cancel(cancel)
            if installed:
                if len(entry.candidates) == 1:
                    candidates = (pack_segments(entry.candidates[0].segments),)
                else:
                    priority = max(c.priority for c in entry.candidates)
                    candidates = tuple(dict.fromkeys(pack_segments(c.segments)
                                                     for c in entry.candidates if c.priority == priority))
                surface, cost = entry.surface, entry.cost if entry.cost is not None else 1
            else:
                priority = max(c["priority"] for c in entry["candidates"])
                candidates = tuple(dict.fromkeys(tuple((s["base"], s["annotate"], tuple(s["units"])) for s in c["segments"])
                                                 for c in entry["candidates"] if c["priority"] == priority))
                surface, cost = entry["surface"], entry.get("cost", 1)
            if installed and len(entry.candidates) > 1:
                all_candidates = tuple(dict.fromkeys(pack_segments(c.segments)
                                                    for c in sorted(entry.candidates, key=lambda c: -c.priority)))
                self.alternatives[surface] = all_candidates
            elif not installed and len(entry["candidates"]) > 1:
                self.alternatives[surface] = tuple(dict.fromkeys(tuple((s["base"], s["annotate"], tuple(s["units"])) for s in c["segments"])
                                                               for c in sorted(entry["candidates"], key=lambda c: -c["priority"])))
            self.entries[surface] = (cost, candidates)
            if len(surface) > self.max_len.get(surface[0], 0):
                self.max_len[surface[0]] = len(surface)
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
            for length in range(1, min(self.max_len.get(text[start], 0), n-start) + 1):
                at = start + length
                entry = self.entries.get(text[start:at])
                if entry is not None and at in ends:
                    edges[start].append((at, (1 if mode == "uniform" else entry[0], 0), entry, "known"))
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
        segments = [dict() for _ in range(n)]
        decoded = {}
        alternative_segments = [dict() for _ in range(n)]
        for start, (stop, _, entry, state) in chosen:
            if trace is not None:
                trace.append({"start": start, "end": stop, "surface": text[start:stop], "status": state})
            if entry is None:
                segments[start][(stop, state, ())] = None
            else:
                key = id(entry)
                if key not in decoded:
                    decoded[key] = entry[1]
                for candidate in decoded[key]:
                    at = start
                    for base, annotate, units in candidate:
                        end = at + len(base)
                        segments[at][(end, "known" if annotate else "unannotated", tuple(units))] = None
                        at = end
                for candidate in self.alternatives.get(text[start:stop], decoded[key]):
                    at = start
                    for base, annotate, units in candidate:
                        end = at + len(base)
                        if annotate:
                            alternative_segments[at][(end, tuple(units))] = None
                        at = end
        # Choose one complete optimal path: shorter next edge first, then the
        # first highest-priority candidate in publisher order.
        # Keep this path intact instead of combining local ambiguous options.
        by_start = {}
        for start, edge in chosen:
            by_start.setdefault(start, []).append(edge)
        defaults = []
        at = 0
        while at < n:
            stop, _, entry, state = min(by_start[at], key=lambda edge: edge[0])
            if entry is None:
                defaults.append((at, stop, state, ()))
            else:
                cursor = at
                for base, annotate, units in decoded[id(entry)][0]:
                    end = cursor + len(base)
                    defaults.append((cursor, end, "known" if annotate else "unannotated", tuple(units)))
                    cursor = end
            at = stop
        output = []
        default_index = 0
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
            ambiguous = len(options) > 1
            while default_index < len(defaults) and defaults[default_index][0] < end:
                start, stop, state, units = defaults[default_index]
                default_index += 1
                alternatives = [units for end, units in alternative_segments[start] if end == stop]
                output.append({"base_start": start, "base_end": stop, "base": text[start:stop],
                               "status": "ambiguous" if ambiguous and state == "known" else state,
                               "units": list(units), **({"alternatives": [list(units), *[list(value) for value in alternatives if value != units]]} if state != "unannotated" and len(alternatives) > 1 else {})})
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
