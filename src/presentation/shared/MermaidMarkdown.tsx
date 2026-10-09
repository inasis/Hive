import { Children, isValidElement, useEffect, useId, useState, type ComponentProps, type ReactNode } from "react";

type MermaidRenderState = { source: string; svg?: string; failed?: true };
type MermaidInstance = typeof import("mermaid").default;

let mermaidInstance: Promise<MermaidInstance> | undefined;

/** Render Mermaid fenced code as a diagram while leaving other code blocks unchanged. */
export function MermaidMarkdownPre({ children }: ComponentProps<"pre">) {
  const source = mermaidSourceFromCode(children);
  return source === null ? <pre>{children}</pre> : <MermaidDiagram source={source} />;
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const diagramId = `hive-mermaid-${reactId || "diagram"}`;
  const [renderState, setRenderState] = useState<MermaidRenderState>({ source });
  const isCurrent = renderState.source === source;

  useEffect(() => {
    let active = true;
    setRenderState({ source });
    void renderMermaidDiagram(diagramId, source).then((svg) => {
      if (active) setRenderState({ source, svg });
    }).catch(() => {
      if (active) setRenderState({ source, failed: true });
    });
    return () => { active = false; };
  }, [diagramId, source]);

  return <figure className="markdown-mermaid">
    {isCurrent && renderState.svg
      ? <div className="markdown-mermaid-svg" role="img" aria-label="Mermaid 다이어그램" dangerouslySetInnerHTML={{ __html: renderState.svg }} />
      : isCurrent && renderState.failed
        ? <>
          <div className="markdown-mermaid-error" role="status">Mermaid 다이어그램을 렌더링할 수 없습니다.</div>
          <pre><code>{source}</code></pre>
        </>
        : <div className="markdown-mermaid-loading" role="status">다이어그램 렌더링 중…</div>}
  </figure>;
}

function mermaidSourceFromCode(children: ReactNode): string | null {
  const codeNode = Children.toArray(children).find((child) => isValidElement(child));
  if (!isValidElement<{ className?: string; children?: ReactNode }>(codeNode)) return null;
  const classes = codeNode.props.className?.split(/\s+/) ?? [];
  if (!classes.some((className) => /^language-mermaid$/i.test(className))) return null;
  return nodeText(codeNode.props.children);
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return "";
}

function renderMermaidDiagram(id: string, source: string): Promise<string> {
  mermaidInstance ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      maxTextSize: 50_000,
      maxEdges: 500,
    });
    return mermaid;
  }).catch((error: unknown) => {
    mermaidInstance = undefined;
    throw error;
  });

  return mermaidInstance.then(async (mermaid) => (await mermaid.render(id, source)).svg);
}
