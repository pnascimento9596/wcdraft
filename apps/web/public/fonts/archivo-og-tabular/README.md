# Archivo OG tabular derivatives

These four WOFF files are derived from the Latin WOFF files in
`../archivo/`, originally distributed by `@fontsource/archivo@5.2.8` under
the SIL Open Font License 1.1 (`../archivo/LICENSE-OFL.txt`).

Next ImageResponse's Satori renderer does not apply OpenType `tnum` features.
The generator therefore changes only the Unicode cmap entries for U+0030
through U+0039 so that they point to Archivo's existing `.tf` glyphs. All
other font tables, glyphs, and Unicode mappings originate from the pinned
upstream files. Regenerate with fonttools 4.63.0:

```sh
python apps/web/scripts/generate-archivo-og-tabular-fonts.py
```

The source and generated SHA-256 values are locked in the typography contract
test. These derivatives remain covered by the adjacent OFL license.
