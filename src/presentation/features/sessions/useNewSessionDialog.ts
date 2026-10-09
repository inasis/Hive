import { useState } from "react";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";

type NewSessionDialogMode = "workspace" | "session";

export type NewSessionDialogOptions = {
  platform: { linuxDesktop: boolean; daemonClient: boolean };
};

/** Own the new-session form lifecycle and workspace folder picker interaction. */
export function useNewSessionDialog({ platform }: NewSessionDialogOptions) {
  const { bridge } = useDesktopUiRuntime();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<NewSessionDialogMode>("workspace");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [permissionPresets, setPermissionPresets] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [choosingWorkspaceFolder, setChoosingWorkspaceFolder] = useState(false);

  const openNewSessionDialog = (nextMode: NewSessionDialogMode = "workspace", initialPath = "") => {
    setMode(nextMode);
    setPath(initialPath);
    setName("");
    setPermissionPresets([]);
    setError("");
    setOpen(true);
  };

  const changePath = (nextPath: string) => {
    setPath(nextPath);
    setError("");
  };

  const changeName = (nextName: string) => {
    setName(nextName);
    setError("");
  };

  const changePermissionPresets = (update: (current: string[]) => string[]) => {
    setPermissionPresets(update);
  };

  const chooseWorkspaceFolder = async () => {
    if (!platform.linuxDesktop || !platform.daemonClient || choosingWorkspaceFolder) return;
    setChoosingWorkspaceFolder(true);
    setError("");
    try {
      const result = await bridge.bridgeRpc.request.chooseWorkspaceFolder({
        ...(path ? { startingFolder: path } : {}),
      });
      if (result.path) setPath(result.path);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setChoosingWorkspaceFolder(false);
    }
  };

  const showCreationError = (message: string) => setError(message);
  const finishCreation = () => {
    setOpen(false);
    setName("");
    setError("");
  };

  return {
    dialog: { open, mode, path, name, permissionPresets, error, choosingWorkspaceFolder },
    openNewSessionDialog,
    closeNewSessionDialog: () => setOpen(false),
    changePath,
    changeName,
    changePermissionPresets,
    chooseWorkspaceFolder,
    showCreationError,
    finishCreation,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
