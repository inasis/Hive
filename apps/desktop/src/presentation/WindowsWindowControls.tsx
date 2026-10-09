import { useEffect, useState } from "react";
import { Icon } from "../../../../src/presentation/shared/Icon";
import { useDesktopUiRuntime } from "../../../../src/presentation/shared/desktop-ui-runtime";

export function WindowsWindowControls({ onError }: { onError?: (message: string) => void }) {
  const { bridge } = useDesktopUiRuntime();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void bridge.bridgeRpc.request.windowAction({ action: "state" })
      .then((result) => setMaximized(result.maximized))
      .catch(() => {});
  }, [bridge]);

  const controlWindow = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const result = await bridge.bridgeRpc.request.windowAction({ action });
      setMaximized(result.maximized);
    } catch (error) {
      onError?.(errorMessage(error));
    }
  };

  return <>
    <button className="window-control windows-window-control" type="button" aria-label="최소화" title="최소화" onClick={() => void controlWindow("minimize")}><Icon name="window-minimize" /></button>
    <button className="window-control windows-window-control" type="button" aria-label={maximized ? "복원" : "최대화"} title={maximized ? "복원" : "최대화"} onClick={() => void controlWindow("toggleMaximize")}><Icon name={maximized ? "window-restore" : "window-maximize"} /></button>
    <button className="window-control windows-window-control" type="button" aria-label="닫기" title="닫기" onClick={() => void controlWindow("close")}><Icon name="close" /></button>
  </>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
