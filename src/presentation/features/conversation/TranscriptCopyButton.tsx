import { memo, useState } from "react";
import { Icon } from "../../shared/Icon";

export const TranscriptCopyButton = memo(function TranscriptCopyButton({ text, label = "메시지 전체" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setState("copied");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      setState(copied ? "copied" : "failed");
    }
    window.setTimeout(() => setState("idle"), 1400);
  };
  return <button type="button" className="message-copy-button" onClick={() => void copy()} aria-label={state === "copied" ? `${label} 복사 완료` : `${label} 복사`} title={`${label} 복사`}><Icon name={state === "copied" ? "check" : "copy"} /><span>{state === "copied" ? "복사됨" : state === "failed" ? "복사 실패" : "복사"}</span></button>;
});
