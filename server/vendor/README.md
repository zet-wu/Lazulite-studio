# QRC 解密模块

`qrc_des.py` 来自 [LDDC](https://github.com/chenmozhijin/LDDC) 提交 `84631e8cd011fcc3f71ca0ae017e2c9758958ffc` 的 Triple DES 实现。保留原作者版权与 GPL-3.0-only 标识，许可全文在 [LDDC-LICENSE](LDDC-LICENSE)。本地修改为使用标准库 `functools.lru_cache(maxsize=4)` 替代应用级 cache.memoize，避免引入其 GUI/缓存依赖。其代码头中的 QQMusicDecoder 参考来源保留。

该模块只用于取得的原始 QRC 载荷解密。HTTP、大小边界和 zlib 解压由 `lyric_sources.py` 管理，歌词语义由前端 codec 解析。

## 日文分段数据

[JmdictFurigana](jmdict-furigana/README.md) 提供精确词形与读音对应的分段。完整固定 JSON 以 gzip 随服务部署，保留数据署名与 CC BY-SA 4.0 许可；与 QRC 模块各自独立。
