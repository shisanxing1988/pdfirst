#!/usr/bin/env python3
"""Generate the CJK webfont subset used by the PDF editor.

Input
    public/fonts/NotoSansSC-Regular-full.ttf   unmodified Google Noto Sans SC (10.1 MB)

Output
    public/fonts/NotoSansSC-8105-v1.ttf        embedded by pdf-lib when exporting
    public/fonts/NotoSansSC-8105-v1.woff2      rendered by the editor UI (@font-face)

Coverage: the 8105 characters of 通用规范汉字表 (2013) — levels 1-3 in
scripts/font-charset/ — plus ASCII, Latin-1, general punctuation, CJK
punctuation and fullwidth forms. Level 3 is the part that matters for real
documents: it holds the characters used mainly in personal and place names
(喆, 玥, 珺, 珲 ...), which GB2312 alone would drop.

The full font stays in public/ as the fallback for anything outside the subset;
app/pdf-edit-export.ts only fetches it when the text being saved needs it.

Re-run after replacing the full font or changing the character set:

    python3 -m venv /tmp/fontenv
    /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python scripts/build-font-subset.py

Bump the -v1 suffix in FILES below when the output changes, so the immutable
Cache-Control rule in public/_headers cannot serve a stale subset.
"""

import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'public/fonts/NotoSansSC-Regular-full.ttf')
CHARSET_DIR = os.path.join(ROOT, 'scripts/font-charset')
TARGETS = {
    'ttf': os.path.join(ROOT, 'public/fonts/NotoSansSC-8105-v1.ttf'),
    'woff2': os.path.join(ROOT, 'public/fonts/NotoSansSC-8105-v1.woff2'),
}

# Characters outside 通用规范汉字表 that still show up in edited documents:
# ASCII, Latin-1, general punctuation, CJK punctuation, fullwidth forms.
EXTRA_RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x2000, 0x206F), (0x3000, 0x303F), (0xFF00, 0xFFEF)]
EXTRA_CHARS = '　·—…“”‘’、。，；：？！（）【】《》〈〉「」『』〔〕〇'


def build_charset():
    characters = set(EXTRA_CHARS)
    for start, end in EXTRA_RANGES:
        characters.update(chr(codepoint) for codepoint in range(start, end + 1))
    for level in (1, 2, 3):
        path = os.path.join(CHARSET_DIR, f'level-{level}.txt')
        with open(path, encoding='utf-8') as handle:
            characters.update(char for char in handle.read() if not char.isspace())
    return characters


def main():
    from fontTools.ttLib import TTFont

    if not os.path.exists(SOURCE):
        sys.exit(f'missing source font: {SOURCE}')
    cmap = set(TTFont(SOURCE, lazy=True).getBestCmap())
    requested = build_charset()
    characters = sorted(char for char in requested if ord(char) in cmap)
    dropped = sorted(char for char in requested if ord(char) not in cmap)
    print(f'requested {len(requested)} characters, font covers {len(characters)}')
    if dropped:
        print(f'not in font, skipped: {"".join(dropped)}')

    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8') as handle:
        handle.write(''.join(characters))
        text_file = handle.name

    try:
        for flavor, output in TARGETS.items():
            command = [
                sys.executable, '-m', 'fontTools.subset', SOURCE,
                f'--text-file={text_file}',
                f'--output-file={output}',
                # Kerning only: the editor writes horizontal text, so vertical
                # metrics and OpenType shaping tables are dead weight.
                '--layout-features=kern',
                '--notdef-outline',
                '--name-IDs=1,2,3,4,6',
                '--recalc-bounds',
                '--drop-tables+=BASE,STAT,GSUB,GPOS,GDEF,vhea,vmtx',
            ]
            if flavor == 'woff2':
                command.append('--flavor=woff2')
            subprocess.run(command, check=True)
            size = os.path.getsize(output)
            print(f'{os.path.relpath(output, ROOT):46s} {size / 1048576:6.2f} MB')
    finally:
        os.unlink(text_file)


if __name__ == '__main__':
    main()
