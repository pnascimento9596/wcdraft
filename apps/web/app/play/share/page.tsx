import type { Metadata } from "next";
import { ShareScreen } from "../../../components/game/share-screen";

export const metadata: Metadata = {
  title: "Share card",
  description: "A shareable card for your run — record, top scorer and seed. No competition marks.",
};

export default function SharePage() {
  return (
    <div className="container page">
      <ShareScreen />
    </div>
  );
}
