import { ImageResponse } from "next/og";

import { RUN_OG_HEIGHT, RUN_OG_WIDTH } from "./run-og-constants";
import type { RunOgLineupSlot, RunOgModel, RunOgRevealModel } from "./run-og-model";
import { RUN_OG_PALETTE as P } from "./run-og-palette";

export interface RunOgImageAssets {
  markSvgDataUri: string;
  fonts: {
    archivoRegular: ArrayBuffer;
    archivoRegularExt: ArrayBuffer;
    archivoMedium: ArrayBuffer;
    archivoMediumExt: ArrayBuffer;
    archivoExtraBold: ArrayBuffer;
    archivoExtraBoldExt: ArrayBuffer;
    archivoBlack: ArrayBuffer;
    archivoBlackExt: ArrayBuffer;
  };
}

const PITCH_W = 680;
const PITCH_H = 468;
const SLOT_W = 126;
const SLOT_H = 50;

export function renderRunOgImage(model: RunOgModel, assets: RunOgImageAssets): ImageResponse {
  return new ImageResponse(<RunOgCard model={model} markSvgDataUri={assets.markSvgDataUri} />, {
    width: RUN_OG_WIDTH,
    height: RUN_OG_HEIGHT,
    fonts: [
      {
        name: "Archivo",
        data: assets.fonts.archivoRegular,
        weight: 400,
        style: "normal",
      },
      {
        name: "Archivo",
        data: assets.fonts.archivoRegularExt,
        weight: 400,
        style: "normal",
      },
      {
        name: "Archivo",
        data: assets.fonts.archivoMedium,
        weight: 500,
        style: "normal",
      },
      {
        name: "Archivo",
        data: assets.fonts.archivoMediumExt,
        weight: 500,
        style: "normal",
      },
      {
        name: "Archivo",
        data: assets.fonts.archivoExtraBold,
        weight: 800,
        style: "normal",
      },
      {
        name: "Archivo",
        data: assets.fonts.archivoExtraBoldExt,
        weight: 800,
        style: "normal",
      },
      {
        name: "Archivo",
        data: assets.fonts.archivoBlack,
        weight: 900,
        style: "normal",
      },
      {
        name: "Archivo",
        data: assets.fonts.archivoBlackExt,
        weight: 900,
        style: "normal",
      },
    ],
  });
}

function RunOgCard({ model, markSvgDataUri }: { model: RunOgModel; markSvgDataUri: string }) {
  return (
    <div
      style={{
        width: RUN_OG_WIDTH,
        height: RUN_OG_HEIGHT,
        display: "flex",
        position: "relative",
        background: P.pageBg,
        color: P.text,
        fontFamily: "Archivo",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background: P.washGradient,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 32,
          top: 28,
          width: 726,
          height: 560,
          display: "flex",
          border: `1px solid ${P.frameLine}`,
          background: P.panel,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 52,
          top: 42,
          width: 686,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: P.muted,
          fontFamily: "Archivo",
          fontSize: 16,
          letterSpacing: 0,
          textTransform: "uppercase",
        }}
      >
        <span>{model.formation_name}</span>
        <span>Starting XI</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 55,
          top: 84,
          width: PITCH_W,
          height: PITCH_H,
          display: "flex",
          border: `2px solid ${P.fieldLine}`,
          background: P.pitch,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: PITCH_H / 2 - 1,
            width: PITCH_W,
            height: 2,
            display: "flex",
            background: P.fieldMidline,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: PITCH_W / 2 - 52,
            top: PITCH_H / 2 - 52,
            width: 104,
            height: 104,
            display: "flex",
            border: `2px solid ${P.fieldLineSoft}`,
            borderRadius: 999,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: PITCH_W / 2 - 54,
            bottom: 0,
            width: 108,
            height: 56,
            display: "flex",
            border: `2px solid ${P.fieldLineSoft}`,
            borderBottom: "0",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: PITCH_W / 2 - 136,
            top: 0,
            width: 272,
            height: 86,
            display: "flex",
            border: `2px solid ${P.fieldLineSoft}`,
            borderTop: "0",
          }}
        />
        {model.lineup.map((slot) => (
          <LineupChip key={slot.slot_id} slot={slot} showOverall={model.reveal !== null} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 780,
          top: 32,
          width: 380,
          height: 566,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={markSvgDataUri} width={62} height={62} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                color: P.gold,
                fontFamily: "Archivo",
                fontSize: 44,
                fontWeight: 900,
                letterSpacing: "-0.035em",
                lineHeight: 0.9,
                textTransform: "uppercase",
              }}
            >
              wcdraft
            </div>
            <div
              style={{
                display: "flex",
                color: P.mutedTeal,
                fontFamily: "Archivo",
                fontSize: 15,
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {model.mode_label} run
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              color: P.goldSoft,
              fontFamily: "Archivo",
              fontSize: 42,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 0.95,
              textTransform: "uppercase",
            }}
          >
            {truncate(model.team_name, 22)}
          </div>
          <div
            style={{
              display: "flex",
              color: P.textStrong,
              fontFamily: "Archivo",
              fontSize: 92,
              fontWeight: 900,
              letterSpacing: "-0.035em",
              lineHeight: 0.9,
              textTransform: "uppercase",
            }}
          >
            {model.result_label}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 12,
              color: P.aqua,
              fontFamily: "Archivo",
              fontSize: 18,
              textTransform: "uppercase",
            }}
          >
            {model.summary.mp} matches · GF {model.summary.gf} · GA {model.summary.ga}
            {model.summary.sw > 0 ? ` · SO W ${model.summary.sw}` : ""}
          </div>
        </div>

        {model.reveal ? (
          <MemoryRevealOgPanel reveal={model.reveal} />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "12px 14px",
              border: `1px solid ${P.aquaSoftLine}`,
              color: P.text,
              background: P.aquaWash,
              fontFamily: "Archivo",
              fontSize: 18,
              lineHeight: 1.18,
            }}
          >
            {wrapText(model.narrative, 42, 3).map((line, i) => (
              <div key={`${line}-${i}`} style={{ display: "flex" }}>
                {line}
              </div>
            ))}
          </div>
        )}

        {model.badges.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {model.badges.map((badge) => (
              <div
                key={`${badge.axis}-${badge.label}`}
                style={{
                  display: "flex",
                  padding: "8px 11px",
                  border: `1px solid ${P.goldLine}`,
                  color: P.goldSoft,
                  background: P.goldWash,
                  fontFamily: "Archivo",
                  fontSize: 15,
                  textTransform: "uppercase",
                }}
              >
                {badge.label}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", height: 38 }} />
        )}

        {model.reveal ? (
          <MemoryRevealOgFacts reveal={model.reveal} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <SectionTitle>Key names</SectionTitle>
            {model.stars.map((star, i) => (
              <div
                key={`${star.nation_code}-${star.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: P.text,
                  fontSize: 19,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: 46,
                    justifyContent: "center",
                    padding: "5px 0",
                    border: `1px solid ${P.aquaLine}`,
                    color: P.aqua,
                    fontFamily: "Archivo",
                    fontSize: 14,
                  }}
                >
                  {star.nation_code}
                </div>
                <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 18 }}>
                  {`${truncate(star.name, 22)} · ${star.overall}`}
                </div>
              </div>
            ))}
            {model.manager ? (
              <FactRow
                label={model.manager.nation_code}
                value={`${truncate(model.manager.name, 22)} · Manager`}
              />
            ) : null}
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 32,
          bottom: 22,
          width: RUN_OG_WIDTH - 64,
          display: "flex",
          justifyContent: "center",
          color: P.muted,
          fontFamily: "Archivo",
          fontSize: 18,
          textTransform: "uppercase",
        }}
      >
        wcdraft.com: draft your own XI
      </div>
    </div>
  );
}

function LineupChip({ slot, showOverall }: { slot: RunOgLineupSlot; showOverall: boolean }) {
  const left = Math.round((slot.x_pct / 100) * PITCH_W - SLOT_W / 2);
  const top = Math.round((slot.y_pct / 100) * PITCH_H - SLOT_H / 2);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: SLOT_W,
        height: SLOT_H,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 9px",
        border: `1px solid ${P.chipLine}`,
        background: P.chip,
      }}
    >
      <Shape shape={slot.shape} badgeKind={slot.badge_kind} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            color: P.textStrong,
            fontFamily: "Archivo",
            fontSize: 13,
            lineHeight: 1.05,
          }}
        >
          {truncate(slot.name, 13)}
        </div>
        <div
          style={{
            display: "flex",
            color: P.aqua,
            fontFamily: "Archivo",
            fontSize: 10,
            lineHeight: 1.2,
            textTransform: "uppercase",
          }}
        >
          {slot.slot_label} · {slot.nation_code}
          {showOverall ? ` · ${formatOgNumber(slot.overall)}` : ""}
        </div>
      </div>
    </div>
  );
}

function MemoryRevealOgPanel({ reveal }: { reveal: RunOgRevealModel }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        border: `1px solid ${P.aquaSoftLine}`,
        color: P.text,
        background: P.aquaWash,
        fontFamily: "Archivo",
        fontSize: 17,
        lineHeight: 1.12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <SectionTitle>Blind -&gt; revealed</SectionTitle>
        <div
          style={{
            display: "flex",
            color: P.goldSoft,
            fontFamily: "Archivo",
            fontSize: 20,
          }}
        >
          {formatOgNumber(reveal.squad_before)} -&gt; {formatOgNumber(reveal.squad_after)} OVR
        </div>
      </div>
      {reveal.lines.map((line) => (
        <div
          key={line.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            color: P.text,
            fontFamily: "Archivo",
            fontSize: 17,
          }}
        >
          <span>{line.label}</span>
          <span style={{ color: P.aqua, fontFamily: "Archivo" }}>
            {formatOgNumber(line.before)} -&gt; {formatOgNumber(line.after)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MemoryRevealOgFacts({ reveal }: { reveal: RunOgRevealModel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <SectionTitle>Top reveals</SectionTitle>
      {reveal.top_reveals.length > 0 ? (
        reveal.top_reveals.map((star, i) => (
          <FactRow
            key={`${star.nation_code}-${star.name}-${i}`}
            label={star.nation_code}
            value={`${formatOgNumber(star.before_overall)} -> ${formatOgNumber(
              star.after_overall,
            )} · ${truncate(star.name, 18)}`}
          />
        ))
      ) : (
        <FactRow label="—" value="—" />
      )}
    </div>
  );
}

function Shape({
  shape,
  badgeKind,
}: {
  shape: RunOgLineupSlot["shape"];
  badgeKind: RunOgLineupSlot["badge_kind"];
}) {
  const fill = P.provenance[badgeKind];
  const mark =
    shape === "triangle" ? (
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: "7px solid transparent",
          borderRight: "7px solid transparent",
          borderBottom: `14px solid ${fill}`,
        }}
      />
    ) : (
      <div
        style={{
          width: 13,
          height: 13,
          background: fill,
          borderRadius: shape === "circle" ? 999 : 1,
          ...(shape === "diamond" ? { transform: "rotate(45deg)" } : {}),
        }}
      />
    );
  return (
    <div
      style={{
        width: 18,
        height: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
      }}
    >
      {mark}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div
      style={{
        display: "flex",
        color: P.muted,
        fontFamily: "Archivo",
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: P.text,
        fontSize: 19,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 46,
          justifyContent: "center",
          padding: "5px 0",
          border: `1px solid ${P.aquaLine}`,
          color: P.aqua,
          fontFamily: "Archivo",
          fontSize: 14,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", fontFamily: "Archivo", fontSize: 18 }}>{value}</div>
    </div>
  );
}

function formatOgNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function wrapText(value: string, maxLineChars: number, maxLines: number): string[] {
  const words = value.replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const rawWord of words) {
    const word = rawWord.length > maxLineChars ? truncate(rawWord, maxLineChars) : rawWord;
    const current = lines[lines.length - 1];
    if (!current) {
      lines.push(word);
      continue;
    }
    if (`${current} ${word}`.length <= maxLineChars) {
      lines[lines.length - 1] = `${current} ${word}`;
      continue;
    }
    if (lines.length >= maxLines) {
      lines[lines.length - 1] = truncate(`${current} ${word}`, maxLineChars);
      break;
    }
    lines.push(word);
  }
  if (lines.length === 0) return ["Run complete."];
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  return lines;
}
