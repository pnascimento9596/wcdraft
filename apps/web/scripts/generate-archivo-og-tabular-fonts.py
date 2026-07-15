"""Generate the OG-only Archivo fonts whose default ASCII digits are tabular.

Next ImageResponse's Satori renderer does not apply Archivo's ``tnum`` GSUB
feature. The web fonts remain byte-identical to @fontsource/archivo 5.2.8;
these four WOFF derivatives only remap U+0030..U+0039 to the existing ``.tf``
glyphs already shipped in each upstream Latin font.

Requires fonttools 4.63.0. Run from anywhere:
  python apps/web/scripts/generate-archivo-og-tabular-fonts.py
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from fontTools import __version__ as FONTTOOLS_VERSION
from fontTools.ttLib import TTFont


WEB_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = WEB_ROOT / "public" / "fonts" / "archivo"
OUTPUT_DIR = WEB_ROOT / "public" / "fonts" / "archivo-og-tabular"
EXPECTED_FONTTOOLS_VERSION = "4.63.0"
SOURCE_SHA256 = {
    400: "9c0a51442fdc30e015f734d04fd957ae00e3f39cc07817050735da301c0d7eda",
    500: "29719fa13f06afbcc46f373e9e94f4ade13aca0fc997e7b4d35fea203cad776c",
    800: "585c9cce853f7140238c31f858aa01f8e913cd1ac88f7675f3f8ed26227f93c5",
    900: "ee2d90e2a8b1155feb250563fc718e19de211756576108019bbb8d7d3b86c62c",
}


def file_sha256(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def tnum_mapping(font: TTFont) -> dict[str, str]:
    gsub = font["GSUB"].table
    mapping: dict[str, str] = {}
    for feature_record in gsub.FeatureList.FeatureRecord:
        if feature_record.FeatureTag != "tnum":
            continue
        for lookup_index in feature_record.Feature.LookupListIndex:
            lookup = gsub.LookupList.Lookup[lookup_index]
            for subtable in lookup.SubTable:
                mapping.update(getattr(subtable, "mapping", {}))
    return mapping


def unicode_cmap(font: TTFont) -> dict[int, str]:
    return {
        codepoint: glyph
        for table in font["cmap"].tables
        if table.isUnicode()
        for codepoint, glyph in table.cmap.items()
    }


def verify_output(source: TTFont, generated_path: Path, substitutions: dict[str, str]) -> None:
    generated = TTFont(generated_path, recalcTimestamp=False)
    source_cmap = unicode_cmap(source)
    generated_cmap = unicode_cmap(generated)
    changed_codepoints = {
        codepoint
        for codepoint in source_cmap.keys() | generated_cmap.keys()
        if source_cmap.get(codepoint) != generated_cmap.get(codepoint)
    }
    expected_codepoints = set(range(ord("0"), ord("9") + 1))
    if changed_codepoints != expected_codepoints:
        raise RuntimeError(
            f"generated cmap changed outside ASCII digits: {sorted(changed_codepoints)}"
        )
    for codepoint in expected_codepoints:
        expected_glyph = substitutions[source_cmap[codepoint]]
        if generated_cmap[codepoint] != expected_glyph:
            raise RuntimeError(f"generated cmap has the wrong glyph for U+{codepoint:04X}")

    # FontTools necessarily rewrites cmap, head checksum metadata, and GSUB
    # offsets when serializing. The glyph outlines, metrics, names, and other
    # semantic tables must remain byte-identical after decompression.
    for tag in ("glyf", "hmtx", "loca", "maxp", "name", "OS/2", "post"):
        if source.getTableData(tag) != generated.getTableData(tag):
            raise RuntimeError(f"generated font unexpectedly changed the {tag} table")
    if tnum_mapping(source) != tnum_mapping(generated):
        raise RuntimeError("generated font unexpectedly changed the tnum feature")


def generate(weight: int) -> Path:
    source = SOURCE_DIR / f"archivo-latin-{weight}-normal.woff"
    expected_sha = SOURCE_SHA256[weight]
    actual_sha = file_sha256(source)
    if actual_sha != expected_sha:
        raise RuntimeError(
            f"upstream Archivo {weight} source hash drifted: {actual_sha} != {expected_sha}"
        )

    font = TTFont(source, recalcTimestamp=False)
    substitutions = tnum_mapping(font)
    if len(substitutions) < 10:
        raise RuntimeError(f"Archivo {weight} is missing its complete tnum feature")

    changed: set[int] = set()
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for codepoint in range(ord("0"), ord("9") + 1):
            source_glyph = table.cmap.get(codepoint)
            if source_glyph is None:
                continue
            # Some cmap subtables share the same mapping object, so an earlier
            # Unicode subtable may already have applied the exact remap.
            target_glyph = (
                source_glyph if source_glyph.endswith(".tf") else substitutions.get(source_glyph)
            )
            if target_glyph is None or not target_glyph.endswith(".tf"):
                raise RuntimeError(
                    f"Archivo {weight} has no tabular substitution for {source_glyph}"
                )
            table.cmap[codepoint] = target_glyph
            changed.add(codepoint)

    expected_codepoints = set(range(ord("0"), ord("9") + 1))
    if changed != expected_codepoints:
        raise RuntimeError(f"Archivo {weight} did not remap every ASCII digit")
    advances = {font["hmtx"][f"{name}.tf"][0] for name in (
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"
    )}
    if len(advances) != 1:
        raise RuntimeError(f"Archivo {weight} tnum glyph advances are not uniform: {advances}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / f"archivo-latin-{weight}-og-tabular.woff"
    font.flavor = "woff"
    font.recalcTimestamp = False
    font.save(output, reorderTables=False)
    verify_output(TTFont(source, recalcTimestamp=False), output, substitutions)
    return output


def main() -> None:
    if FONTTOOLS_VERSION != EXPECTED_FONTTOOLS_VERSION:
        raise RuntimeError(
            f"fonttools {EXPECTED_FONTTOOLS_VERSION} is required; found {FONTTOOLS_VERSION}"
        )
    for weight in SOURCE_SHA256:
        output = generate(weight)
        print(f"{output.relative_to(WEB_ROOT)} {output.stat().st_size} {file_sha256(output)}")


if __name__ == "__main__":
    main()
