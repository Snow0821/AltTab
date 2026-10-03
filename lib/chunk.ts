// 쪽별 글자를 청크로 나눈다(소유: 교안 모듈). 청크는 쪽을 넘지 않아 근거 위치 "교안 번호:쪽"이 정확하다.
const MAX = 900;

export type PageText = { page: number; text: string };
export type Chunk = { page: number; seq: number; content: string };

export function clean(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function chunkPages(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  let seq = 0;
  for (const { page, text } of pages) {
    const body = clean(text);
    if (!body) continue;
    let rest = body;
    while (rest.length > MAX) {
      // 문장 끝이나 줄바꿈에서 자른다. 없으면 MAX에서 자른다.
      const window = rest.slice(0, MAX);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("다."));
      const at = cut > MAX * 0.5 ? cut + 1 : MAX;
      chunks.push({ page, seq: seq++, content: rest.slice(0, at).trim() });
      rest = rest.slice(at).trim();
    }
    if (rest) chunks.push({ page, seq: seq++, content: rest });
  }
  return chunks;
}

export function parseRef(ref: string): { no: number; page: number } | null {
  const m = /^(\d{1,2}):(\d{1,4})$/.exec(String(ref).trim());
  return m ? { no: Number(m[1]), page: Number(m[2]) } : null;
}
