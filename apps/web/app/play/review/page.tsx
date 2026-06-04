import type { Metadata } from "next";
import { ReviewScreen } from "../../../components/game/review-screen";

export const metadata: Metadata = {
  title: "Squad review",
  description:
    "Your committed XI on the formation, five on the bench, your manager, rating by line and a Synergy summary — then simulate the run.",
};

export default function ReviewPage() {
  return (
    <div className="container page">
      <ReviewScreen />
    </div>
  );
}
