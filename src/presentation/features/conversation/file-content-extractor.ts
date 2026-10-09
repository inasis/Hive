import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  PROMPT_FILE_ATTACHMENT_MAX_BYTES,
} from "../../../domain/prompt-attachments.js";

const MAX_PDF_PAGES = 100;
const NON_TEXT_DOCUMENT_EXTENSIONS = new Set([
  "doc", "docm", "xls", "xlsm", "ppt", "pptm", "pptx", "xlsx", "odt", "ods", "odp", "odg", "epub",
]);

export async function extractPromptFileContent(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return extractPdfText(file);
  if (extension === "docx") return extractDocxText(file);
  if (NON_TEXT_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error("이 문서 형식은 지원하지 않습니다. PDF, DOCX 또는 UTF-8 텍스트 파일을 선택해 주세요.");
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error("PDF, DOCX 또는 UTF-8 텍스트 파일만 내용 첨부할 수 있습니다.");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) {
    throw new Error("PDF, DOCX 또는 UTF-8 텍스트 파일만 내용 첨부할 수 있습니다.");
  }
  return content;
}

async function extractDocxText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const worker = new Worker(new URL("./docx-text-extractor.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, content?: string) => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      if (error) reject(error);
      else resolve(content ?? "");
    };
    const timeoutId = window.setTimeout(() => {
      finish(new Error("DOCX 내용 추출 시간이 초과되었습니다."));
    }, 15_000);
    worker.addEventListener("message", (event: MessageEvent<{ content?: string; error?: string }>) => {
      if (typeof event.data.content === "string") finish(undefined, event.data.content);
      else finish(new Error(event.data.error || "DOCX 파일에서 내용을 추출하지 못했습니다."));
    }, { once: true });
    worker.addEventListener("error", () => {
      finish(new Error("DOCX 파일에서 내용을 추출하지 못했습니다. 파일이 손상되었거나 지원하지 않는 문서일 수 있습니다."));
    }, { once: true });
    worker.postMessage(data, [data]);
  });
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF는 최대 ${MAX_PDF_PAGES}페이지까지 내용 첨부할 수 있습니다.`);
    }
    const pages: string[] = [];
    let sizeBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const pageText = text.items
        .flatMap((item) => "str" in item ? [`${item.str}${item.hasEOL ? "\n" : " "}`] : [])
        .join("")
        .trim();
      if (!pageText) continue;
      sizeBytes += new TextEncoder().encode(pageText).byteLength;
      if (sizeBytes > PROMPT_FILE_ATTACHMENT_MAX_BYTES) {
        throw new Error(`PDF에서 추출한 내용은 ${PROMPT_FILE_ATTACHMENT_MAX_BYTES / 1024} KB까지 첨부할 수 있습니다.`);
      }
      pages.push(pageText);
    }
    if (!pages.length) {
      throw new Error("PDF에서 텍스트를 찾지 못했습니다. 스캔 문서는 이미지로 첨부해 주세요.");
    }
    return pages.join("\n\n");
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("PDF는") || error.message.startsWith("PDF에서"))) throw error;
    throw new Error("PDF 파일에서 내용을 추출하지 못했습니다. 암호화되었거나 손상된 파일일 수 있습니다.");
  } finally {
    await loadingTask.destroy();
  }
}
