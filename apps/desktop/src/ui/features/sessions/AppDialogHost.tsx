import type { ComponentProps } from "react";
import { NewSessionDialog } from "./NewSessionDialog";
import { SessionDialogs } from "./SessionDialogs";

type AppDialogHostProps = {
  newSession: ComponentProps<typeof NewSessionDialog>;
  sessions: ComponentProps<typeof SessionDialogs>;
};

export function AppDialogHost({ newSession, sessions }: AppDialogHostProps) {
  return <>
    <NewSessionDialog {...newSession} />
    <SessionDialogs {...sessions} />
  </>;
}
