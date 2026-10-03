// PDF 쪽별 글자를 브라우저와 같은 unpdf로 뽑아 JSON으로 저장한다(체험 과목·검증 스크립트용).
// 실행: node scripts/pdf-dump.ts <PDF 경로> <출력 JSON 경로>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { getDocumentProxy, extractText } from "unpdf";

const [src, out] = process.argv.slice(2);
const buf = readFileSync(src);
const pdf = await getDocumentProxy(new Uint8Array(buf));
const { text } = await extractText(pdf, { mergePages: false });
const body = {
  filename: basename(src),
  fileHash: createHash("sha256").update(buf).digest("hex"),
  sizeBytes: buf.length,
  pages: (text as string[]).map((t, i) => ({ page: i + 1, text: t })),
};
writeFileSync(out, JSON.stringify(body));
console.log(`${body.pages.length}쪽 → ${out}`);
