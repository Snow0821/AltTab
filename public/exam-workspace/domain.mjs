/** Pure, framework-independent helpers. These functions never persist data or call an API. */
export function filterQuestions(questions, { search = '', difficulty = '', concept = '' } = {}) {
  const term = search.trim().toLocaleLowerCase('ko-KR');
  return questions.filter((q) => (!difficulty || String(q.difficulty) === difficulty)
    && (!concept || q.concept === concept)
    && (!term || `${q.body} ${q.concept}`.toLocaleLowerCase('ko-KR').includes(term)));
}

export function selectedQuestions(questions, ids) {
  const selected = new Set(ids);
  return questions.filter((q) => selected.has(q.id));
}

/** Demo grading only. Production must grade server-side without exposing answer keys. */
export function gradeDemo(paper, questions, answers, attemptId, submittedAt) {
  const items = paper.questionIds.map((id) => questions.find((q) => q.id === id));
  if (!items.length || items.some((q) => !q)) throw new Error('시험지 문항을 찾을 수 없습니다.');
  if (items.some((q) => !Number.isInteger(answers[q.id]) || answers[q.id] < 0 || answers[q.id] >= q.choices.length)) {
    throw new Error('모든 문항에 답한 뒤 제출해 주세요.');
  }
  const details = items.map((q) => ({ questionId: q.id, answer: answers[q.id], correct: answers[q.id] === q.answerIndex }));
  const correctCount = details.filter((item) => item.correct).length;
  return {
    attemptId, examId: paper.id, examVersion: paper.version,
    score: correctCount * 10, maxScore: items.length * 10,
    correctCount, questionCount: items.length, submittedAt, details,
  };
}

export const insufficientRanking = () => ({
  status: 'insufficient_data', observedRank: null, cohortSize: null,
  sampleSize: 0, estimatedRank: null, lowerRank: null, upperRank: null,
  method: null, calculatedAt: null,
});

/** Fail closed: a display must never manufacture a rank from a score alone. */
export function rankingView(ranking = insufficientRanking()) {
  if (!ranking || typeof ranking !== 'object' || Array.isArray(ranking)) ranking = insufficientRanking();
  const count = (v) => Number.isInteger(v) && v > 0;
  const sampleSize = Number.isInteger(ranking.sampleSize) && ranking.sampleSize >= 0 ? ranking.sampleSize : 0;
  const cohortSize = count(ranking.cohortSize) ? ranking.cohortSize : null;
  const validObserved = ['observed', 'estimated'].includes(ranking.status)
    && count(ranking.observedRank) && sampleSize > 0 && ranking.observedRank <= sampleSize;
  const validEstimated = ranking.status === 'estimated' && sampleSize > 0 && cohortSize >= sampleSize
    && count(ranking.estimatedRank) && count(ranking.lowerRank) && count(ranking.upperRank)
    && ranking.lowerRank <= ranking.estimatedRank && ranking.estimatedRank <= ranking.upperRank
    && ranking.upperRank <= cohortSize && typeof ranking.method === 'string' && ranking.method.trim()
    && typeof ranking.calculatedAt === 'string' && Number.isFinite(Date.parse(ranking.calculatedAt));
  return {
    observed: validObserved ? `${ranking.observedRank}위 / ${sampleSize}명` : '집계 대기',
    estimated: validEstimated ? `${ranking.lowerRank}–${ranking.upperRank}위` : '표본 부족',
    estimatePoint: validEstimated ? `${ranking.estimatedRank}위` : null,
    sampleSize, cohortSize,
    method: validEstimated ? ranking.method : '추정 방법 미연결',
    calculatedAt: validEstimated ? ranking.calculatedAt : null,
  };
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
