import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "wcdraft: World Cup draft game",
    short_name: "wcdraft",
    description:
      "A football drafting game: spin a team and year, pick your XI, chase the perfect run.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f100e",
    theme_color: "#3f9268",
    categories: ["games", "sports", "entertainment"],
    icons: [
      { src: "/icons/icon-32.png", sizes: "32x32", type: "image/png", purpose: "any" },
      { src: "/icons/icon-64.png", sizes: "64x64", type: "image/png", purpose: "any" },
      { src: "/icons/icon-120.png", sizes: "120x120", type: "image/png", purpose: "any" },
      { src: "/icons/icon-152.png", sizes: "152x152", type: "image/png", purpose: "any" },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
