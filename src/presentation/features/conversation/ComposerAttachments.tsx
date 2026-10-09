import { useRef } from "react";
import { assistantProviderSupports } from "../../../domain/provider-catalog.js";
import { Icon } from "../../shared/Icon";
import type { AssistantProvider } from "../../shared/bridge";
import type { LocalFileAttachment, LocalImageAttachment } from "../../shared/conversation-view";

export function ComposerAttachments({
  provider,
  busy,
  openingThread,
  imageAttachments,
  onAddImages,
  onRemoveImage,
  fileAttachments,
  onAddFiles,
  onRemoveFile,
}: {
  provider: AssistantProvider;
  busy: boolean;
  openingThread: boolean;
  imageAttachments: LocalImageAttachment[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  fileAttachments: LocalFileAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supportsImages = assistantProviderSupports(provider, "images");
  const supportsFileAttachments = assistantProviderSupports(provider, "fileAttachments");

  if (!supportsImages && !supportsFileAttachments) return null;

  return <>
    <div className="composer-image-control">
      {supportsImages && <>
        <input
          ref={imageInputRef}
          className="composer-image-input"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            onAddImages(files);
          }}
        />
        <button
          type="button"
          disabled={busy || openingThread}
          onClick={() => imageInputRef.current?.click()}
          aria-label="이미지 첨부"
          title="이미지 첨부 또는 붙여넣기"
        >
          <Icon name="files" />이미지 첨부
        </button>
      </>}
      {supportsFileAttachments && <>
        <input
          ref={fileInputRef}
          className="composer-file-input"
          type="file"
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            onAddFiles(files);
          }}
        />
        <button
          type="button"
          disabled={busy || openingThread}
          onClick={() => fileInputRef.current?.click()}
          aria-label="파일 내용 첨부"
          title="PDF, DOCX 또는 UTF-8 텍스트 파일의 내용을 첨부"
        >
          <Icon name="files" />파일 첨부
        </button>
      </>}
    </div>
    {supportsImages && imageAttachments.length > 0 && <div className="composer-image-attachments">
      {imageAttachments.map((image) => <div className="composer-image-attachment" key={image.id}>
        <img src={`data:${image.mimeType};base64,${image.data}`} alt="" />
        <span title={image.name}>{image.name}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemoveImage(image.id)}
          aria-label={`${image.name} 첨부 제거`}
          title="첨부 제거"
        >
          <Icon name="close" />
        </button>
      </div>)}
    </div>}
    {supportsFileAttachments && fileAttachments.length > 0 && <div className="composer-file-attachments">
      {fileAttachments.map((file) => <div className="composer-file-attachment" key={file.id}>
        <Icon name="files" />
        <span title={file.name}>{file.name}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemoveFile(file.id)}
          aria-label={`${file.name} 첨부 제거`}
          title="첨부 제거"
        >
          <Icon name="close" />
        </button>
      </div>)}
    </div>}
  </>;
}
