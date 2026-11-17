import type { ReactNode } from "react";

import { DueReminder } from "./due-reminder";

export default async function HouseholdLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  return (
    <>
      {children}
      <DueReminder householdId={householdId} />
    </>
  );
}
