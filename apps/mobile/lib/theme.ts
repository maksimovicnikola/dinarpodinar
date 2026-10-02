import type { LimitState } from "@finance/domain";

export const colors = {
  bg: "#F5F6F8",
  surface: "#FFFFFF",
  text: "#14171C",
  muted: "#626B77",
  line: "#E3E6EA",
  lineStrong: "#D3D8DE",
  soft: "#EEF0F3",
  accent: "#155E63",
  accentStrong: "#0F4A4E",
  accentSoft: "#E6F1F1",
  near: "#B7791F",
  nearSoft: "#FBF3E6",
  over: "#C0362C",
  overSoft: "#FCEDEB",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { card: 12, control: 10, pill: 999 } as const;

export const type = {
  caption: { fontSize: 13, lineHeight: 18 },
  small: { fontSize: 15, lineHeight: 20 },
  body: { fontSize: 17, lineHeight: 22 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "600" as const },
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700" as const, letterSpacing: -0.5 },
} as const;

export const meterColor: Record<LimitState, string> = {
  free: "#B9C0C8",
  ok: colors.accent,
  near: colors.near,
  over: colors.over,
};
