# JmdictFurigana data

This service uses JmdictFurigana by Doublevil, derived from JMdict by James William BREEN and the Electronic Dictionary Research and Development Group (EDRDG). The data is licensed under Creative Commons Attribution-ShareAlike 4.0; see LICENSE.txt, EDRDG-licence.html and UPSTREAM-README.md. The upstream software's MIT licence is not the data licence.

- Source: https://github.com/Doublevil/JmdictFurigana
- Fixed release: 2.3.1+2026-09-25
- Download: https://github.com/Doublevil/JmdictFurigana/releases/download/2.3.1%2B2026-09-25/JmdictFurigana.json.zip
- Original ZIP SHA-256: b4c27a835767e9b8bd87bd5a30c9691ad3d1d5100d4a131590628c2d547ce5d8
- Original JSON SHA-256: 2a8e206f0b171fa5acdce89e5f5798621b227175e5bfa2db6bd92fef63dd962e

JmdictFurigana.json.gz contains the complete original JSON bytes, unchanged (including BOM), compressed with gzip mtime=0. Ship this directory with the Python service; no runtime downloads. The service checks the uncompressed hash and builds an exact surface/reading index once per process; ambiguous or non-recomposing entries do not supply a split.

Maintain data updates as reviewed dependency updates: check upstream releases monthly, download and record the new fixed release and hashes, regenerate gzip, update server/furigana.py SHA256, and run reading, frozen-song and integration regressions before shipping. No automatic production updates or dictionary UI.
