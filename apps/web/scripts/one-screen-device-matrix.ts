import { devices } from "playwright-core";

type DeviceDescriptor = (typeof devices)[string];

export type OneScreenEngine = "chromium" | "webkit";

export type OneScreenDeviceCase = {
  readonly name: string;
  readonly source: string;
  readonly descriptor: DeviceDescriptor;
  readonly strictVerticalFit: boolean;
  readonly delegatedDecision?: string;
};

function namedDescriptor(name: string): DeviceDescriptor {
  const descriptor = devices[name];
  if (!descriptor) throw new Error(`Playwright device descriptor is unavailable: ${name}`);
  return descriptor;
}

/**
 * Assertion matrix for the two one-screen routes.
 *
 * Every case is a Playwright 1.61.1 built-in descriptor except the explicitly
 * disclosed 1366-width desktop intent. Playwright has no 1366 descriptor, so
 * that case changes only the viewport width of the engine's built-in desktop
 * descriptor and retains its real 720px viewport height and all other fields.
 */
export function oneScreenDeviceCases(engine: OneScreenEngine): readonly OneScreenDeviceCase[] {
  const desktopName = engine === "webkit" ? "Desktop Safari" : "Desktop Chrome";
  const desktop = namedDescriptor(desktopName);
  if (!desktop.viewport) throw new Error(`${desktopName} is missing its viewport`);

  return [
    {
      name: "320-mobile",
      source: "iPhone SE",
      descriptor: namedDescriptor("iPhone SE"),
      strictVerticalFit: false,
      delegatedDecision:
        "320x568 may scroll vertically; horizontal overflow, reachability, paint, target size, theme, motion, zoom, and browser-error assertions remain strict.",
    },
    {
      name: "360-mobile",
      source: "Pixel 9",
      descriptor: namedDescriptor("Pixel 9"),
      strictVerticalFit: true,
    },
    {
      name: "390-mobile",
      source: "iPhone 13",
      descriptor: namedDescriptor("iPhone 13"),
      strictVerticalFit: true,
    },
    {
      name: "430-mobile",
      source: "iPhone 14 Pro Max",
      descriptor: namedDescriptor("iPhone 14 Pro Max"),
      strictVerticalFit: true,
    },
    {
      name: "short-landscape",
      source: "iPhone SE (3rd gen) landscape",
      descriptor: namedDescriptor("iPhone SE (3rd gen) landscape"),
      strictVerticalFit: true,
    },
    {
      name: "tablet-portrait",
      source: "iPad Mini",
      descriptor: namedDescriptor("iPad Mini"),
      strictVerticalFit: true,
    },
    {
      name: "tablet-landscape",
      source: "iPad Mini landscape",
      descriptor: namedDescriptor("iPad Mini landscape"),
      strictVerticalFit: true,
    },
    { name: "desktop", source: desktopName, descriptor: desktop, strictVerticalFit: true },
    {
      name: "desktop-1366-width",
      source: `${desktopName} with viewport-width override`,
      descriptor: {
        ...desktop,
        viewport: { ...desktop.viewport, width: 1366 },
      },
      strictVerticalFit: true,
      delegatedDecision:
        "Playwright has no built-in 1366 descriptor; preserve the engine desktop descriptor and override only viewport width 1280 to 1366.",
    },
  ];
}

/**
 * Historical screenshot sizes are review artifacts only. They are deliberately
 * absent from oneScreenDeviceCases so device heights can never become fit-gate
 * viewport heights again.
 */
export const LEGACY_SCREENSHOT_EVIDENCE = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
] as const;
