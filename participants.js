'use strict';

/**
 * 참가자 세션 (FR-13~15 공통).
 *
 * - 서버가 무작위 토큰(비밀)을 발급하고 브라우저가 보관한다. 토큰의 해시가 참가자 식별값(participantId)이다.
 * - 요청은 X-Participant-Token 헤더(또는 body.participantToken)로 본인을 증명한다.
 *   서버는 토큰에서 식별값을 다시 계산하므로 클라이언트가 보낸 participantId·점수는 쓰지 않는다.
 * - 토큰은 로그인이 아니다. 토큰을 지우면 새 참가자가 되므로 참가 수는 익명 참가 기록 기준이다.
 */

const crypto = require('crypto');

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32바이트 base64url

function idFromToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}

function issue() {
  const participantToken = crypto.randomBytes(32).toString('base64url');
  return { participantId: idFromToken(participantToken), participantToken };
}

// 요청에서 참가자 식별값을 얻는다. 토큰이 없거나 형식이 다르면 null.
function fromRequest(req) {
  const header = typeof req.get === 'function' ? req.get('x-participant-token') : null;
  const raw = header || (req.body && req.body.participantToken) || '';
  if (!TOKEN_RE.test(raw)) return null;
  return idFromToken(raw);
}

function requireParticipant(req) {
  const participantId = fromRequest(req);
  if (!participantId) {
    const err = new Error('참가자 토큰이 필요합니다. POST /api/participants로 먼저 발급받으세요.');
    err.statusCode = 401;
    err.code = 'participant_required';
    throw err;
  }
  return participantId;
}

module.exports = { issue, idFromToken, fromRequest, requireParticipant };
