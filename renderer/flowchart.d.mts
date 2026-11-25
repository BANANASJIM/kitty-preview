export interface Mark {
  from: string;
  to: string;
  start: string;
  end: string;
  isHidden: boolean;
}
export function normalizeFlowchart(source: string): { drawable: string; marks: Mark[] };
export function unmask(svg: string): string;
