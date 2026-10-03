// 교안 업로드 본문 크기 확인(소유: 교안 모듈). Vercel 함수 요청 본문 제한(4.5MB) 안에 들어가는지
// 글자 수가 아니라 실제로 보낼 JSON의 UTF-8 바이트 수로 판단한다. 한글은 글자당 3바이트다.
export const MAX_UPLOAD_BYTES = 4_000_000; // 4.5MB 제한에 여유를 둔 값

export type UploadBody = { filename: string; fileHash: string; sizeBytes: number; pages: { page: number; text: string }[] };

export function uploadBytes(body: UploadBody): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

export function fitsUpload(body: UploadBody): boolean {
  return uploadBytes(body) <= MAX_UPLOAD_BYTES;
}
