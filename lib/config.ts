// 설정의 단일 원천. 모델 이름·기준값·호출 상한·업로드 제한·가격을 여기서만 정한다(PRD 8절).
// 서버 전용 값은 환경 변수로 바꿀 수 있고, 화면에서도 쓰는 값(가격·업로드 제한)은 이 파일의 기본값을 함께 쓴다.
// 스테이지 규칙(5문제, 4개 정답, 첫 유닛 무료 등)은 PRD 4절의 규칙이라 lib/rules.ts에 둔다.

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
}

export const AI = {
  gatewayUrl: process.env.AI_GATEWAY_URL || "https://ai-gateway.vercel.sh/v1",
  // 임베딩: Gateway 무료 등급에서 호출되는 모델(2026-10-03 실측). 차원은 supabase/schema.sql의 vector(1536)과 같아야 한다.
  embedModel: process.env.EMBED_MODEL || "alibaba/qwen3-embedding-4b",
  embedDim: 1536,
  // 웹 첫 유닛 생성(FR-12): 학교 생성형 AI API를 먼저, 키가 없거나 실패하면 Gateway 모델을 쓴다.
  schoolUrl: process.env.SCHOOL_AI_URL || "https://ai.cs.kookmin.ac.kr",
  schoolModel: process.env.SCHOOL_GEN_MODEL || "claude-sonnet-5",
  schoolMaxOutputTokens: num(process.env.SCHOOL_GEN_MAX_OUTPUT_TOKENS, 8000),
  schoolTimeoutMs: num(process.env.SCHOOL_GEN_TIMEOUT_MS, 60_000),
  genModel: process.env.GEN_MODEL || "google/gemini-2.5-flash",
  genMaxOutputTokens: num(process.env.GEN_MAX_OUTPUT_TOKENS, 16000),
  genDailyLimitPerCourse: num(process.env.GEN_DAILY_LIMIT, 3),
  genConcepts: 5,
  genQuestionsPerConcept: 5,
  genContextChars: num(process.env.GEN_CONTEXT_CHARS, 24000),
  genTimeoutMs: num(process.env.GEN_TIMEOUT_MS, 50_000),
};

export const QUALITY = {
  evidenceMin: num(process.env.EVIDENCE_MIN, 0.5), // FR-03 근거 불일치 기준
  importanceMin: num(process.env.IMPORTANCE_MIN, 0.6), // 개념과 관련 있다고 보는 청크 유사도
};

export const LIMITS = {
  signupPerHour: num(process.env.SIGNUP_LIMIT_PER_HOUR, 60),
  materialMinBytes: 1024,
  materialMaxBytes: 50 * 1024 * 1024,
  materialsPerCourse: 20,
  uploadMaxBytes: 4_000_000, // 브라우저가 보내는 글자 JSON의 UTF-8 바이트 상한(Vercel 요청 본문 약 4.5MB)
};

export const PRODUCTS = {
  course_pass: { amount: 2900, title: "과목 이용권 2,900원", detail: "이 과목, 기간 제한 없음. 6번째 스테이지부터 이어서 풀 수 있어요." },
  exam_30d: { amount: 9900, title: "시험 기간 구독 9,900원", detail: "결제한 때부터 30일, 모든 과목. 과목이 3개 이상이면 더 유리해요.", days: 30 },
} as const;

export type ProductId = keyof typeof PRODUCTS;
