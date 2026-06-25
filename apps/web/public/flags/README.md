# Flag assets

## Source

National-flag SVGs in this directory come from
[lipis/flag-icons](https://github.com/lipis/flag-icons) — the `flags/4x3/` set,
fetched from the upstream `main` branch on 2026-06-06.

- Repository license: **MIT** (code/scripts in flag-icons).
- Asset content: depicts each country's **national flag**, the visual design of
  which is in the public domain. No crests, kits, federation marks, official competition marks,
  competition marks, or maker logos are included.
- Ratio: 4×3.

## File naming

Files are named by the wcdraft runtime `nation_id` (the authoritative key in
`@wcdraft/data`), not by ISO code. This keeps the slot-reveal mapping stable
across historical and current World Cup nations.

The full mapping (`nation_id → flag-icons slug → flag file`) is recorded in
[`manifest.json`](./manifest.json) in this directory.

## Historical / substitute notes

`lipis/flag-icons` only ships modern national flags. For the historical World
Cup nations the runtime exposes, we use the listed substitute and note the
choice in `manifest.json`. The substitutions are visually faithful where
possible and conservative otherwise — they are never crests or unrelated
imagery.

| nation_id | nation                | substitute            | reason                                                                                         |
| --------- | --------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `T-21`    | Czechoslovakia        | `cz` (Czech Republic) | The 1920–1992 Czechoslovak flag and the modern Czech flag are visually identical.              |
| `T-23`    | Dutch East Indies     | `id` (Indonesia)      | The 1945 Indonesian flag was adopted from the DEI red-over-white.                              |
| `T-24`    | East Germany          | `de` (Germany)        | flag-icons does not ship a public-domain GDR SVG. Substituted with the modern German tricolor. |
| `T-67`    | Serbia and Montenegro | `rs` (Serbia)         | flag-icons does not ship a SCG-era SVG; modern Serbian flag used as the closest successor.     |
| `T-72`    | Soviet Union          | `ru` (Russia)         | flag-icons does not ship a public-domain USSR SVG. Modern Russian flag used as substitute.     |
| `T-86`    | West Germany          | `de` (Germany)        | The 1949–1990 BRD tricolor is visually identical to the modern German flag.                    |
| `T-87`    | Yugoslavia            | `rs` (Serbia)         | flag-icons does not ship an SFRY SVG; modern Serbian flag used as substitute.                  |
| `T-88`    | Zaire                 | `cd` (DR Congo)       | Modern DR Congo flag used as the closest successor.                                            |

## Provenance

Each download was performed via `https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/<slug>.svg`.
See `manifest.json` for the exact slug used per `nation_id`.
