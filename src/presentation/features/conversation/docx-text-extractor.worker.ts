import mammoth from "mammoth";

self.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
  void extract(event.data);
});

async function extract(data: ArrayBuffer): Promise<void> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    self.postMessage({ content: result.value });
  } catch {
    self.postMessage({ error: "DOCX 파일에서 내용을 추출하지 못했습니다. 파일이 손상되었거나 지원하지 않는 문서일 수 있습니다." });
  }
}
