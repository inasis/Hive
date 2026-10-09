import { useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { DaemonConnectionsPort } from "./shared/daemon-connections";
import { Icon } from "./shared/Icon";

/** Rename a saved daemon and own the dialog's form and keyboard lifecycle. */
export function DaemonRenameDialog({ daemonId, daemonName, renameDaemon, onClose, onOpenStateChange }: {
  daemonId: string;
  daemonName: string;
  renameDaemon: DaemonConnectionsPort["rename"];
  onClose: () => void;
  onOpenStateChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(daemonName);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpenStateChange(true);
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      onOpenStateChange(false);
      returnFocus?.focus();
    };
  }, [onClose, onOpenStateChange]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      renameDaemon(daemonId, name);
      onClose();
    } catch (reason) { setError(errorMessage(reason)); }
  };
  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return <div className="dialog-backdrop daemon-rename-backdrop" onMouseDown={closeOnBackdrop}>
    <form className="connect-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="rename-daemon-dialog-title" onSubmit={save}>
      <div className="dialog-mark"><Icon name="edit" /></div>
      <h2 id="rename-daemon-dialog-title">서버 이름 수정</h2>
      <p>서버 목록에 표시할 이름을 입력하세요.</p>
      <label htmlFor="rename-daemon-name">서버 이름</label>
      <input id="rename-daemon-name" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} maxLength={100} />
      {error && <div className="connection-error" role="alert">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="dialog-secondary" onClick={onClose}>취소</button>
        <button type="submit" className="dialog-primary" disabled={!name.trim()}>이름 저장</button>
      </div>
    </form>
  </div>;
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
