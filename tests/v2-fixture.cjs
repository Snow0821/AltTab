const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261003063714_alttab_v2_exams.sql'), 'utf8');
const questions = JSON.parse(sql.match(/'(\[\n[\s\S]+?\n \])'::jsonb/)[1]);

function memoryStore() {
  const sample = { id: randomUUID(), title: '자료구조 · 핵심 개념', source: 'sample', created_at: new Date().toISOString(), questions };
  const exams = new Map([[sample.id, sample]]), attempts = new Map(), jobs = new Map();
  return {
    sample, exams, attempts, jobs,
    async list() { return [...exams.values()].map(({ id, title, source, created_at }) => ({ id, title, source, created_at })); },
    async get(id) { return exams.get(id); },
    async attempt(id, participant) { return attempts.get(`${id}:${participant}`); },
    async begin(id, participant, nickname) {
      const key = `${id}:${participant}`;
      if (!attempts.has(key)) attempts.set(key, { id: randomUUID(), nickname, participant_key: participant, exam_id: id, result: null });
      return attempts.get(key);
    },
    async submit(id, participant, result) { const row = await this.attempt(id, participant); if (!row.result) row.result = result; return row; },
    async ranking(id, participant) {
      const all = [...attempts.values()].filter(a => a.exam_id === id && a.result).sort((a, b) => b.result.score - a.result.score);
      const rows = all.map(a => ({ position: 1 + all.filter(b => b.result.score > a.result.score).length, nickname: a.nickname, score: a.result.score, mine: a.participant_key === participant }));
      return { participants: rows.length, rows, mine: rows.find(r => r.mine) || null };
    },
    async claim(participant, fingerprint) {
      const old = [...jobs.values()].find(j => j.participant === participant && j.fingerprint === fingerprint);
      if (old) return old;
      const job = { id: randomUUID(), participant, fingerprint, state: 'pending' }; jobs.set(job.id, job);
      return { ...job, state: 'claimed' };
    },
    async complete(id, exam) {
      exams.set(id, { ...exam, id, source: 'ai', created_at: new Date().toISOString() });
      Object.assign(jobs.get(id), { state: 'ready', examId: id }); return id;
    },
    async fail(id) { jobs.get(id).state = 'failed'; },
  };
}
module.exports = { memoryStore, questions };
