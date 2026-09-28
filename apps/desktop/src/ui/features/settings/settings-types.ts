import type { ReactNode } from "react";

export type ThemeMode = "dark" | "light";

export type ConnectionPresentation = {
  pageDescription: string;
  formTitle: string;
  formDescription: string;
  formHelp: ReactNode;
  providerKind: string;
  runtimeLabel: string;
  statusDescription: string;
};
