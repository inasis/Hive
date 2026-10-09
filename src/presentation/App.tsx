import { WorkspacePageContainer, type WorkspacePageContainerProps } from "./WorkspacePageContainer";

export type AppProps = WorkspacePageContainerProps;

/** Renderer entry point for the active workspace page. */
export function App(props: AppProps = {}) {
  return <WorkspacePageContainer {...props} />;
}
