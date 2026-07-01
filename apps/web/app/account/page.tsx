import type { Metadata } from "next";

import { requireSignedInServerSession } from "@/lib/auth/server-session";
import { readAccountRunsPage } from "@/lib/account/runs";
import { AccountClient } from "./account-client";
import "./account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account",
  description: "Manage your wcdraft account, saved runs, stats, and password.",
  robots: { index: false, follow: false },
};

export default async function AccountPage(): Promise<React.ReactElement> {
  const session = await requireSignedInServerSession("/account");
  const initial = await readAccountRunsPage(session.deps.db, session.userId, {
    limit: 25,
    offset: 0,
  });
  return <AccountClient initial={initial} />;
}
