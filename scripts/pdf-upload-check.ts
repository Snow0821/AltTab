// 브라우저와 같은 unpdf로 PDF 글자를 뽑아 업로드 판정(UTF-8 4MB)과 청크 수를 미리 확인한다.
// 실행: node scripts/pdf-upload-check.ts <PDF 경로>...
// Node에서 같은 라이브러리로 본 결과이며, 실제 브라우저 결과는 배포 주소에서 다시 확인한다.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { getDocumentProxy, extractText } from "unpdf";
import { uploadBytes, fitsUpload, MAX_UPLOAD_BYTES } from "../lib/upload.ts";
import { chunkPages } from "../lib/chunk.ts";

for (const path of process.argv.slice(2)) {
  const buf = readFileSync(path);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: t }));
  const body = { filename: basename(path), fileHash: createHash("sha256").update(buf).digest("hex"), sizeBytes: buf.length, pages };
  const chars = pages.reduce((s, p) => s + p.text.length, 0);
  const bytes = uploadBytes(body);
  console.log(`${basename(path)} | ${totalPages}쪽, 파일 ${buf.length.toLocaleString()}B, 글자 ${chars.toLocaleString()}자`);
  console.log(`  업로드 JSON ${bytes.toLocaleString()}B / 상한 ${MAX_UPLOAD_BYTES.toLocaleString()}B → ${fitsUpload(body) ? "업로드" : "거절"}`);
  if (fitsUpload(body)) {
    const chunks = chunkPages(pages);
    console.log(`  청크 ${chunks.length}개, 첫 쪽 앞 40자: ${pages[0].text.slice(0, 40).replace(/\s+/g, " ")}`);
  }
}
