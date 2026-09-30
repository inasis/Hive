import { useEffect, useState } from "react";
import { bridgeRpc } from "../../bridgeClient";
import { Icon } from "../../shared/Icon";

export function WindowsWindowControls({ onError }: { onError?: (message: string) => void }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void bridgeRpc.request.windowAction({ action: "state" })
      .then((result) => setMaximized(result.maximized))
      .catch(() => {});
  }, []);

  const controlWindow = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const result = await bridgeRpc.request.windowAction({ action });
      setMaximized(result.maximized);
    } catch (error) {
      onError?.(errorMessage(error));
    }
  };

  return <>
    <button className="window-control windows-window-control" type="button" aria-label="최소화" title="최소화" onClick={() => void controlWindow("minimize")}><Icon name="window-minimize" /></button>
    <button className="window-control windows-window-control" type="button" aria-label={maximized ? "복원" : "최대화"} title={maximized ? "복원" : "최대화"} onClick={() => void controlWindow("toggleMaximize")}><Icon name={maximized ? "window-restore" : "window-maximize"} /></button>
    <button className="window-control windows-window-control windows-window-control-close" type="button" aria-label="닫기" title="닫기" onClick={() => void controlWindow("close")}><Icon name="close" /></button>
  </>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
