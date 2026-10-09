import type { MountedUiMotionOptions } from "./useMountedUiMotion";
import { useMountedUiMotion } from "./useMountedUiMotion";
import type { WorkspacePageTransitionMotionOptions } from "./useWorkspacePageTransitionMotion";
import { useWorkspacePageTransitionMotion } from "./useWorkspacePageTransitionMotion";
import type { WorkspacePanelMotionOptions } from "./useWorkspacePanelMotion";
import { useWorkspacePanelMotion } from "./useWorkspacePanelMotion";

type WorkspaceMotionProps = MountedUiMotionOptions & WorkspacePageTransitionMotionOptions & WorkspacePanelMotionOptions;

/** Keep the workspace animation runtime in its own on-demand presentation chunk. */
export function WorkspaceMotion(props: WorkspaceMotionProps): null {
  useMountedUiMotion(props);
  useWorkspacePanelMotion(props);
  useWorkspacePageTransitionMotion(props);
  return null;
}
