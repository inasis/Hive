export function effortLabel(value: string): string {
  const labels: Record<string, string> = {
    off: "끄기",
    minimal: "최소",
    low: "낮음",
    medium: "보통",
    high: "높음",
    xhigh: "매우 높음",
    max: "최대",
    ultra: "울트라",
  };
  return labels[value] ?? value;
}
