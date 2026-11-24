"""Japanese cardinal numbers and common counter readings for Arabic digits."""
import re
import unicodedata

DIGITS = ('れい', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう')


def cardinal(text: str) -> str:
    digits = unicodedata.normalize('NFKC', text)
    # Large identifiers remain pronounceable without inventing unsupported units.
    if len(digits.lstrip('0')) > 20:
        return ''.join(DIGITS[int(char)] for char in digits)

    def group(value):
        parts = []
        for scale, name, irregular in [(1000, 'せん', {3: 'さんぜん', 8: 'はっせん'}),
                                       (100, 'ひゃく', {3: 'さんびゃく', 6: 'ろっぴゃく', 8: 'はっぴゃく'}),
                                       (10, 'じゅう', {})]:
            digit, value = divmod(value, scale)
            if digit:
                parts.append(irregular.get(digit, ('' if digit == 1 else DIGITS[digit]) + name))
        if value:
            parts.append(DIGITS[value])
        return ''.join(parts)

    number = int(digits.lstrip('0') or '0')
    if number == 0:
        return DIGITS[0]
    parts = []
    for index, name in enumerate(('', 'まん', 'おく', 'ちょう', 'けい')):
        number, value = divmod(number, 10000)
        if value:
            parts.insert(0, group(value) + name)
    return ''.join(parts)


COUNTERS = re.compile(r'[0-9０-９]+(?:か月|ヶ月|[人本匹杯分個回階歳才冊台枚年円月日時秒])')


def counted(text: str, suffix_reading: str) -> str:
    match = re.fullmatch(r'([0-9０-９]+)(.+)', text)
    digits, suffix = match.groups()
    normalized = unicodedata.normalize('NFKC', digits).lstrip('0') or '0'
    n = int(normalized) if len(normalized) <= 20 else 100 + int(normalized[-2:])
    stem = cardinal(digits)
    if suffix == '人':
        return {1: 'ひとり', 2: 'ふたり'}.get(n, ('よ' if n == 4 else stem) + 'にん')
    if suffix in ('歳', '才') and n == 20:
        return 'はたち'
    if suffix == '日' and n in {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24}:
        return {1:'ついたち',2:'ふつか',3:'みっか',4:'よっか',5:'いつか',6:'むいか',7:'なのか',8:'ようか',9:'ここのか',10:'とおか',14:'じゅうよっか',20:'はつか',24:'にじゅうよっか'}[n]
    if suffix == '月':
        return {4:'し',7:'しち',9:'く'}.get(n, stem) + 'がつ'
    if suffix == '時':
        return {4:'よ',7:'しち',9:'く'}.get(n, stem) + 'じ'
    ending = n % 10
    if suffix in ('本', '匹', '杯', '分'):
        unvoiced, voiced, semi = {'本':('ほん','ぼん','ぽん'),'匹':('ひき','びき','ぴき'),'杯':('はい','ばい','ぱい'),'分':('ふん','ふん','ぷん')}[suffix]
        if stem.endswith(('いち', 'ろく', 'はち', 'じゅう', 'ひゃく', 'びゃく', 'ぴゃく')):
            for old, new in [('いち','いっ'),('ろく','ろっ'),('はち','はっ'),('じゅう','じゅっ'),('ひゃく','ひゃっ'),('びゃく','びゃっ'),('ぴゃく','ぴゃっ')]:
                if stem.endswith(old):
                    return stem[:-len(old)] + new + semi
        if ending == 3:
            return stem + (semi if suffix == '分' else voiced)
        return stem + (semi if suffix == '分' and ending == 4 else unvoiced)
    if suffix in ('個','回','階','歳','才','冊','か月','ヶ月'):
        for old, new in [('いち','いっ'),('はち','はっ'),('じゅう','じゅっ')]:
            if stem.endswith(old):
                stem = stem[:-len(old)] + new
                break
        if suffix in ('個','回','階','か月','ヶ月') and stem.endswith('ろく'):
            stem = stem[:-2] + 'ろっ'
        reading = {'個':'こ','回':'かい','階':'かい','歳':'さい','才':'さい','冊':'さつ','か月':'かげつ','ヶ月':'かげつ'}[suffix]
        if suffix == '階' and ending == 3:
            reading = 'がい'
        return stem + reading
    return stem + suffix_reading
