import { ImageResponse } from "next/og";

import { RUN_OG_HEIGHT, RUN_OG_WIDTH } from "./run-og-constants";
import type { RunOgLineupSlot, RunOgModel } from "./run-og-model";

export interface RunOgImageAssets {
  markSvgDataUri: string;
  fonts: {
    spaceGroteskSemiBold: ArrayBuffer;
    spaceGroteskSemiBoldExt: ArrayBuffer;
    spaceGroteskBold: ArrayBuffer;
    spaceGroteskBoldExt: ArrayBuffer;
    spaceMonoBold: ArrayBuffer;
    spaceMonoBoldExt: ArrayBuffer;
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
        name: "Space Grotesk",
        data: assets.fonts.spaceGroteskSemiBold,
        weight: 600,
        style: "normal",
      },
      {
        name: "Space Grotesk",
        data: assets.fonts.spaceGroteskSemiBoldExt,
        weight: 600,
        style: "normal",
      },
      {
        name: "Space Grotesk",
        data: assets.fonts.spaceGroteskBold,
        weight: 700,
        style: "normal",
      },
      {
        name: "Space Grotesk",
        data: assets.fonts.spaceGroteskBoldExt,
        weight: 700,
        style: "normal",
      },
      {
        name: "Space Mono",
        data: assets.fonts.spaceMonoBold,
        weight: 700,
        style: "normal",
      },
      {
        name: "Space Mono",
        data: assets.fonts.spaceMonoBoldExt,
        weight: 700,
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
        background: "#07120f",
        color: "#f3ecd4",
        fontFamily: "Space Grotesk",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background:
            "linear-gradient(135deg, rgba(16,185,129,0.22), rgba(7,18,15,0.18) 36%, rgba(231,191,84,0.18))",
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
          border: "1px solid rgba(243,236,212,0.22)",
          background: "rgba(5, 13, 11, 0.76)",
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
          color: "#d6c997",
          fontFamily: "Space Mono",
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
          border: "2px solid rgba(84, 211, 159, 0.45)",
          background: "#0b211b",
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
            background: "rgba(84,211,159,0.26)",
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
            border: "2px solid rgba(84,211,159,0.24)",
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
            border: "2px solid rgba(84,211,159,0.24)",
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
            border: "2px solid rgba(84,211,159,0.24)",
            borderTop: "0",
          }}
        />
        {model.lineup.map((slot) => (
          <LineupChip key={slot.slot_id} slot={slot} />
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
                color: "#e7bf54",
                fontFamily: "Space Grotesk",
                fontSize: 44,
                lineHeight: 0.9,
                textTransform: "uppercase",
              }}
            >
              wcdraft
            </div>
            <div
              style={{
                display: "flex",
                color: "#97b7a9",
                fontFamily: "Space Mono",
                fontSize: 15,
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
              color: "#f7e0a0",
              fontFamily: "Space Grotesk",
              fontSize: 42,
              lineHeight: 0.95,
              textTransform: "uppercase",
            }}
          >
            {truncate(model.team_name, 22)}
          </div>
          <div
            style={{
              display: "flex",
              color: "#ffffff",
              fontFamily: "Space Grotesk",
              fontSize: 92,
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
              color: "#9fd8bf",
              fontFamily: "Space Mono",
              fontSize: 18,
              textTransform: "uppercase",
            }}
          >
            {model.summary.mp} matches · GF {model.summary.gf} · GA {model.summary.ga}
            {model.summary.sw > 0 ? ` · SO W ${model.summary.sw}` : ""}
          </div>
        </div>

        {model.badges.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {model.badges.map((badge) => (
              <div
                key={`${badge.axis}-${badge.label}`}
                style={{
                  display: "flex",
                  padding: "8px 11px",
                  border: "1px solid rgba(231,191,84,0.48)",
                  color: "#f7e0a0",
                  background: "rgba(231,191,84,0.08)",
                  fontFamily: "Space Mono",
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

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <SectionTitle>Key names</SectionTitle>
          {model.stars.map((star, i) => (
            <div
              key={`${star.nation_code}-${star.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "#f3ecd4",
                fontSize: 19,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 46,
                  justifyContent: "center",
                  padding: "5px 0",
                  border: "1px solid rgba(159,216,191,0.38)",
                  color: "#9fd8bf",
                  fontFamily: "Space Mono",
                  fontSize: 14,
                }}
              >
                {star.nation_code}
              </div>
              <div style={{ display: "flex", fontFamily: "Space Grotesk", fontSize: 18 }}>
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
      </div>
    </div>
  );
}

function LineupChip({ slot }: { slot: RunOgLineupSlot }) {
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
        border: "1px solid rgba(243,236,212,0.28)",
        background: "rgba(3, 10, 8, 0.82)",
      }}
    >
      <Shape shape={slot.shape} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            color: "#ffffff",
            fontFamily: "Space Grotesk",
            fontSize: 13,
            lineHeight: 1.05,
          }}
        >
          {truncate(slot.name, 13)}
        </div>
        <div
          style={{
            display: "flex",
            color: "#9fd8bf",
            fontFamily: "Space Mono",
            fontSize: 10,
            lineHeight: 1.2,
            textTransform: "uppercase",
          }}
        >
          {slot.slot_label} · {slot.nation_code}
        </div>
      </div>
    </div>
  );
}

function Shape({ shape }: { shape: RunOgLineupSlot["shape"] }) {
  const mark =
    shape === "triangle" ? (
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: "7px solid transparent",
          borderRight: "7px solid transparent",
          borderBottom: "14px solid #e7bf54",
        }}
      />
    ) : (
      <div
        style={{
          width: 13,
          height: 13,
          background: "#e7bf54",
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
        color: "#d6c997",
        fontFamily: "Space Mono",
        fontSize: 15,
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
        color: "#f3ecd4",
        fontSize: 19,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 46,
          justifyContent: "center",
          padding: "5px 0",
          border: "1px solid rgba(159,216,191,0.38)",
          color: "#9fd8bf",
          fontFamily: "Space Mono",
          fontSize: 14,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", fontFamily: "Space Grotesk", fontSize: 18 }}>{value}</div>
    </div>
  );
}

function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/gu, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}
