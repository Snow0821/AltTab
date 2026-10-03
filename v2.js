'use strict';

const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStore } = require('./v2-store');
const ai = require('./v2-ai');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function publicExam(exam) {
  return { id: exam.id, title: exam.title, source: exam.source, createdAt: exam.created_at,
    questions: exam.questions.map(({ id, body, choices }) => ({ id, body, choices })) };
}

function grade(exam, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) ||
    Object.keys(answers).length !== exam.questions.length || exam.questions.some(q => !Number.isInteger(answers[q.id]) || answers[q.id] < 0 || answers[q.id] > 3)) {
    fail(400, '모든 문제의 답을 골라 주세요.');
  }
  const details = exam.questions.map(q => ({ ...q, picked: answers[q.id], correct: answers[q.id] === q.answerIndex }));
  const correct = details.filter(q => q.correct).length;
  return { score: Math.round(correct / details.length * 100), correct, total: details.length, details };
}

function register(app, { store = createStore(), generate = ai.generate, env = process.env } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'POST') {
      const origins = new Set(['https://alt-tab-mu.vercel.app']);
      for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
        if (host && /^[a-z0-9.-]+\.vercel\.app$/i.test(host)) origins.add(`https://${host}`);
      }
      if (!env.VERCEL && env.NODE_ENV !== 'production') {
        const port = env.PORT || '3000'; origins.add(`http://localhost:${port}`); origins.add(`http://127.0.0.1:${port}`);
      }
      if (!origins.has(req.get('origin')) || (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site')))) return res.status(403).json({ message: '같은 사이트에서 요청해 주세요.' });
      if (!req.is('application/json')) return res.status(415).json({ message: 'JSON 형식으로 요청해 주세요.' });
    }
    let token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('pf_v2='))?.slice(6);
    if (!/^[a-f0-9]{64}$/.test(token || '')) {
      token = crypto.randomBytes(32).toString('hex');
      res.cookie('pf_v2', token, { httpOnly: true, sameSite: 'lax', secure: Boolean(env.VERCEL || env.NODE_ENV === 'production'), maxAge: 90 * 86400000, path: '/api/v2' });
    }
    req.participant = crypto.createHash('sha256').update(token).digest('hex');
    next();
  });
  router.use(express.json({ limit: '200kb' }));
  const run = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const getExam = async id => {
    if (!uuid.test(id)) fail(404, '시험을 찾을 수 없어요.');
    const exam = await store.get(id);
    if (!exam) fail(404, '시험을 찾을 수 없어요.');
    return exam;
  };
  router.get('/exams', run(async (req, res) => res.json({ exams: await store.list(), aiAvailable: Boolean(env.KOOKMIN_KEY) })));
  router.get('/exams/:id', run(async (req, res) => {
    const exam = await getExam(req.params.id);
    const attempt = await store.attempt(exam.id, req.participant);
    res.json({ exam: publicExam(exam), attempt: attempt ? { nickname: attempt.nickname, result: attempt.result } : null });
  }));
  router.post('/exams/:id/start', run(async (req, res) => {
    const exam = await getExam(req.params.id);
    const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
    if (!nickname || [...nickname].length > 20 || /[\u0000-\u001f]/.test(nickname)) fail(400, '닉네임을 1~20자로 입력해 주세요.');
    const attempt = await store.begin(exam.id, req.participant, nickname);
    res.json({ exam: publicExam(exam), attempt: { nickname: attempt.nickname, result: attempt.result } });
  }));
  router.post('/exams/:id/submit', run(async (req, res) => {
    const exam = await getExam(req.params.id);
    const attempt = await store.attempt(exam.id, req.participant);
    if (!attempt) fail(409, '닉네임을 입력하고 시험을 시작해 주세요.');
    if (attempt.result) return res.json({ result: attempt.result });
    const saved = await store.submit(exam.id, req.participant, grade(exam, req.body.answers));
    res.json({ result: saved.result });
  }));
  router.get('/exams/:id/ranking', run(async (req, res) => {
    await getExam(req.params.id);
    res.json(await store.ranking(req.params.id, req.participant));
  }));
  router.post('/exams', run(async (req, res) => {
    const source = ai.input(req.body);
    if (!env.KOOKMIN_KEY) fail(503, '문제 생성 연결을 준비 중이에요. 준비된 시험을 먼저 풀어 주세요.');
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
    const claim = await store.claim(req.participant, fingerprint);
    if (claim.state === 'ready') return res.json({ id: claim.examId });
    if (claim.state === 'pending') fail(409, '같은 교안으로 문제를 만들고 있어요. 잠시 후 다시 확인해 주세요.');
    if (claim.state === 'limited') fail(429, '오늘의 문제 생성 횟수에 도달했어요. 준비된 시험을 이용해 주세요.');
    try {
      const questions = await generate(source);
      const id = await store.complete(claim.id, { title: source.title, questions });
      res.status(201).json({ id });
    } catch (error) { await store.fail(claim.id).catch(() => {}); throw error; }
  }));
  router.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : error.status || 500;
    res.status(status).json({ message: error.status ? error.message : status === 413 ? '선택한 교안 범위가 너무 커요.' : '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  });
  app.use('/api/v2', router);
  app.use('/v2', (req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  }, express.static(path.join(__dirname, 'public/v2')));
}

module.exports = register;
module.exports.grade = grade;
module.exports.publicExam = publicExam;
