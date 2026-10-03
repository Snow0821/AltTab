import test from 'node:test';
import assert from 'node:assert/strict';
import { filterQuestions, selectedQuestions, gradeDemo, rankingView, insufficientRanking, escapeHtml } from '../../public/exam-workspace/domain.mjs';
import { DEMO_QUESTIONS as questions } from '../../public/exam-workspace/demo-data.mjs';
const paper = { id: 'exam', version: 2, questionIds: ['demo-q1', 'demo-q2'] };
const stamp = '2026-10-03T05:00:00.000Z';
test('filters intersect search, concept, and difficulty without mutating fixtures', () => {
  assert.equal(filterQuestions(questions).length, 8);
  assert.equal(filterQuestions(questions, { search: '  FIFO ' }).length, 0); // Search deliberately excludes hidden choices/answers.
  assert.equal(filterQuestions(questions, { search: '큐' }).length, 2);
  assert.equal(filterQuestions(questions, { concept: '스택과 큐', difficulty: '2' }).length, 0);
  assert.equal(filterQuestions(questions, { concept: '시간 복잡도', difficulty: '3' }).length, 1);
  assert.equal(filterQuestions(questions, { search: '<script>' }).length, 0);
  assert.equal(questions.length, 8);
});
test('selection ignores unknown IDs and deduplicates', () => {
  assert.deepEqual(selectedQuestions(questions, ['demo-q1', 'demo-q1', 'missing']).map((q) => q.id), ['demo-q1']);
});
test('grading binds result to exact paper version and allows zero-index answer', () => {
  const result = gradeDemo(paper, questions, { 'demo-q1': 1, 'demo-q2': 0 }, 'attempt-1', stamp);
  assert.equal(result.score, 10); assert.equal(result.maxScore, 20); assert.equal(result.correctCount, 1);
  assert.equal(result.questionCount, 2); assert.equal(result.examId, 'exam'); assert.equal(result.examVersion, 2);
  assert.equal(result.attemptId, 'attempt-1'); assert.equal(result.submittedAt, stamp);
  assert.deepEqual(result.details.map((x) => x.correct), [true, false]);
});
test('all correct and all wrong grade without rounding or hidden points', () => {
  assert.equal(gradeDemo(paper, questions, { 'demo-q1': 1, 'demo-q2': 2 }, 'a', stamp).score, 20);
  assert.equal(gradeDemo(paper, questions, { 'demo-q1': 0, 'demo-q2': 0 }, 'b', stamp).score, 0);
});
test('missing, malformed, and out-of-range answers cannot submit', () => {
  for (const answer of [undefined, null, '1', -1, 4, 1.5, NaN]) {
    assert.throws(() => gradeDemo(paper, questions, { 'demo-q1': answer, 'demo-q2': 2 }, 'a', stamp), /모든 문항/);
  }
  assert.throws(() => gradeDemo({ ...paper, questionIds: [] }, questions, {}, 'a', stamp), /문항을 찾을/);
  assert.throws(() => gradeDemo({ ...paper, questionIds: ['absent'] }, questions, {}, 'a', stamp), /문항을 찾을/);
});
test('unconnected ranking never invents observed or estimated rank', () => {
  for (const value of [null, undefined, [], 'not ranking']) assert.equal(rankingView(value).estimated, '표본 부족');
  const view = rankingView(insufficientRanking());
  assert.equal(view.observed, '집계 대기'); assert.equal(view.estimated, '표본 부족');
  assert.equal(view.sampleSize, 0); assert.equal(view.cohortSize, null); assert.equal(view.estimatePoint, null);
});
test('observed rank is separate from estimation and limited to its sample', () => {
  const view = rankingView({ ...insufficientRanking(), status: 'observed', observedRank: 3, sampleSize: 8 });
  assert.equal(view.observed, '3위 / 8명'); assert.equal(view.estimated, '표본 부족');
  assert.equal(rankingView({ status: 'observed', observedRank: 9, sampleSize: 8 }).observed, '집계 대기');
});
test('estimate requires sample, population, bounds, method, and timestamp', () => {
  const valid = { status: 'estimated', observedRank: 3, sampleSize: 20, cohortSize: 100, estimatedRank: 15, lowerRank: 9, upperRank: 24, method: 'Test fixture method', calculatedAt: stamp };
  assert.equal(rankingView(valid).estimated, '9–24위'); assert.equal(rankingView(valid).estimatePoint, '15위');
  for (const change of [{ sampleSize: 0 }, { cohortSize: 5 }, { lowerRank: 16 }, { upperRank: 101 }, { method: '' }, { method: '  ' }, { calculatedAt: null }, { estimatedRank: NaN }, { lowerRank: -1 }, { status: 'insufficient_data' }]) {
    assert.equal(rankingView({ ...valid, ...change }).estimated, '표본 부족');
  }
});
test('user text is HTML escaped before rendering', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'alert(1)\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;');
});
