import type { ReactNode } from "react";

export type ConnectionPresentation = {
  pageDescription: string;
  formTitle: string;
  formDescription: string;
  formHelp: ReactNode;
  providerKind: string;
  runtimeLabel: string;
  statusDescription: string;
};
