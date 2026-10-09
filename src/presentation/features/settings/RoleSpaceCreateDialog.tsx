import type { MouseEvent } from "react";
import { Icon } from "../../shared/Icon";

export function RoleSpaceCreateDialog({ open, onCancel, onConfirm }: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onCancel();
  };

  return <div className="dialog-backdrop" onMouseDown={closeOnBackdrop}>
    <section className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="create-role-space-title">
      <div className="dialog-mark"><Icon name="sparkles" /></div>
      <h2 id="create-role-space-title">역할 공간 추가</h2>
      <p>새 역할 공간을 만들까요? 공간 이름과 페르소나, A2A 및 A2B 권한은 이후에 설정할 수 있습니다.</p>
      <div className="dialog-actions">
        <button type="button" className="dialog-secondary" onClick={onCancel} autoFocus>취소</button>
        <button type="button" className="dialog-primary" onClick={onConfirm}>만들기</button>
      </div>
    </section>
  </div>;
}
