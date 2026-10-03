// 서비스가 쓰는 임베딩(text-embedding-3-small, Vercel AI Gateway) 실제 호출 점검과 기준값 확인.
// 실행: node --env-file=.env.local scripts/embed-check.ts
import { embed, cosine, EMBED_DIM } from "../lib/embed.ts";

const page = "스택은 데이터를 쌓아 올리는 자료구조로, 가장 나중에 넣은 데이터를 가장 먼저 꺼내는 후입선출(LIFO) 방식으로 동작한다. push로 넣고 pop으로 꺼낸다.";
const other = "TCP는 연결 지향 프로토콜로, 데이터를 보내기 전에 3-way handshake로 연결을 수립한다. 흐름 제어와 혼잡 제어를 제공한다.";
const question = "스택에서 가장 나중에 넣은 데이터를 가장 먼저 꺼내는 방식을 무엇이라 하는가?\n정답: 후입선출(LIFO)";
const wrongAnswerQuestion = "스택에서 가장 나중에 넣은 데이터를 가장 먼저 꺼내는 방식을 무엇이라 하는가?\n정답: 선입선출(FIFO)";

const pairs: [string, string, string][] = [
  ["스택은 후입선출(LIFO) 구조이다", "스택은 선입선출(FIFO) 구조이다", "오답(반대 개념)"],
  ["프로세스는 실행 중인 프로그램이다", "프로세스는 실행 중인 프로그램이 아니다", "오답(부정문)"],
  ["TCP 연결 수립은 3단계 핸드셰이크로 이루어진다", "TCP 연결 수립은 4단계 핸드셰이크로 이루어진다", "오답(숫자)"],
  ["후입선출", "선입선출", "오답(단답형 반대)"],
  ["스택은 후입선출(LIFO) 구조이다", "스택은 마지막에 넣은 것을 먼저 꺼내는 구조이다", "정답(바꿔 말함)"],
];

const texts = [page, other, question, wrongAnswerQuestion, ...pairs.flatMap(([a, b]) => [a, b])];
const t0 = Date.now();
const v = await embed(texts);
console.log(`호출 성공: ${v.length}개, 차원 ${v[0].length}(기대 ${EMBED_DIM}), ${Date.now() - t0}ms`);
console.log(`근거 쪽 관련성: 문항↔관련 쪽 ${cosine(v[2], v[0]).toFixed(3)}, 문항↔무관 쪽 ${cosine(v[2], v[1]).toFixed(3)}, 정답만 틀린 문항↔관련 쪽 ${cosine(v[3], v[0]).toFixed(3)} (기준 0.5)`);
pairs.forEach(([a, b, label], i) => {
  const s = cosine(v[4 + i * 2], v[5 + i * 2]);
  console.log(`${s.toFixed(3)} ${s >= 0.6 ? "0.6 이상" : "0.6 미만"} | ${label} | ${b}`);
});
