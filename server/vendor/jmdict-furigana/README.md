# JmdictFurigana data

This service uses JmdictFurigana by Doublevil, derived from JMdict by James William BREEN and the Electronic Dictionary Research and Development Group (EDRDG). The data is licensed under Creative Commons Attribution-ShareAlike 4.0; see LICENSE.txt, EDRDG-licence.html and UPSTREAM-README.md. The upstream software's MIT licence is not the data licence.

- Source: https://github.com/Doublevil/JmdictFurigana
- Bundled release: 2.3.1+2026-09-25
- Download: https://github.com/Doublevil/JmdictFurigana/releases/download/2.3.1%2B2026-09-25/JmdictFurigana.json.zip
- Original ZIP SHA-256: b4c27a835767e9b8bd87bd5a30c9691ad3d1d5100d4a131590628c2d547ce5d8
- Original JSON SHA-256: 2a8e206f0b171fa5acdce89e5f5798621b227175e5bfa2db6bd92fef63dd962e

JmdictFurigana.json.gz contains the complete original JSON bytes, unchanged (including BOM), compressed with gzip mtime=0. Ship this directory with the Python service; no runtime downloads. The service decodes gzip/UTF-8 JSON and validates the entry structure, then builds an exact surface/reading index once per process; ambiguous or non-recomposing entries do not supply a split.

Replacement data uses a JSON array of objects with string `text` and `reading`, and a `furigana` array of objects containing string `ruby` and optional string `rt` (defaults to `ruby`). Additional fields are ignored. Same-structure content can replace the resource without source changes; restart the service to rebuild its process-local index. Preserve provenance and licensing for distributed data, and check relevant segmentation behavior before shipping. The hashes above describe the bundled source only.
