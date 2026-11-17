"use client";

import { useEffect } from "react";

/** Prvi ulazak u domaćinstvo šalje podsetnik za dospeće, jednom po pravilu. */
export function VisitAlerts({ householdId }: { householdId: string }) {
  useEffect(() => {
    void fetch("/api/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ householdId }),
    }).catch(() => undefined);
  }, [householdId]);

  return null;
}
