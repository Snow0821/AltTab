'use strict';

/**
 * 이용권(entitlement) 판정 + 테스트(모의) 결제 모듈. (PRD FR-06)
 *
 * 규칙
 * - 이용권이 없으면 첫 유닛(스테이지 5개)까지만 플레이할 수 있다.
 *   6번째 스테이지(유닛 2)부터는 이용권이 필요하다.
 * - 이용권 종류:
 *     course_pass : 과목 영구 이용권(2,900원). 만료 없음.
 *     subscription: 시험 기간 구독 30일. 만료 시각 이후에는 다시 막힌다.
 * - 결제는 "테스트(모의) 결제"만 지원한다. 실제 금전 결제는 하지 않는다.
 * - 이미 유효한 이용권이 있는 과목은 중복 구매되지 않는다("이미 이용권이 있어요").
 *
 * API 계약(team-work-plan.md §4)
 * - getAccess(courseId, userId, { stageUnit }) ->
 *     { canPlay, reason, paymentMode, hasEntitlement, entitlementType, expiresAt, freeUnitLimit }
 * - purchase(courseId, userId, plan) ->
 *     { ok, entitlement } 또는 중복/실패 시 statusCode 에러
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const FREE_UNIT_LIMIT = 1; // 무료로 열리는 유닛 수(유닛1 = 스테이지 5개)
const SUBSCRIPTION_DAYS = 30;
const PAYMENT_MODE = 'test'; // 모의 결제. 실제 결제 아님.

const PLANS = {
  course_pass: { label: '과목 이용권', price: 2900, type: 'permanent' },
  subscription: { label: '시험 기간 구독 30일', price: 0, type: 'subscription', days: SUBSCRIPTION_DAYS }
};

// ----- 저장소 (로컬 JSON 폴백) -----
const dataRoot = process.env.VERCEL ? os.tmpdir() : __dirname;
const storeFile = path.join(dataRoot, 'uploads', 'entitlements.json');

function ensureStore() {
  const dir = path.dirname(storeFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storeFile)) fs.writeFileSync(storeFile, '[]');
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(storeFile, 'utf-8'));
  } catch {
    return [];
  }
}

function writeStore(list) {
  ensureStore();
  fs.writeFileSync(storeFile, JSON.stringify(list, null, 2));
}

function keyOf(courseId, userId) {
  return `${courseId}::${userId}`;
}

// 만료되지 않은 유효 이용권을 반환. 없으면 null.
function findActiveEntitlement(courseId, userId, now = Date.now()) {
  const list = readStore();
  const matches = list.filter(
    (e) => e.courseId === courseId && e.userId === userId
  );
  for (const e of matches) {
    if (e.expiresAt === null) return e; // 영구
    if (Date.parse(e.expiresAt) > now) return e; // 아직 유효한 구독
  }
  return null;
}

/**
 * 접근 판정. stageUnit은 플레이하려는 스테이지가 속한 유닛 번호(1-based).
 * stageUnit을 주지 않으면 과목 전체의 이용권 보유 여부만 판정한다.
 */
function getAccess(courseId, userId = 'anonymous', opts = {}) {
  if (!courseId) {
    const err = new Error('courseId가 필요합니다.');
    err.statusCode = 400;
    throw err;
  }
  const uid = String(userId || 'anonymous');
  const now = opts.now || Date.now();
  const active = findActiveEntitlement(courseId, uid, now);
  const hasEntitlement = !!active;
  const stageUnit = Number.isInteger(opts.stageUnit) ? opts.stageUnit : null;

  // 유닛 기준 판정: 무료 유닛(1) 이내면 이용권 없이도 플레이 가능.
  let canPlay;
  let reason;
  if (stageUnit === null) {
    canPlay = true; // 과목 열람 자체는 허용(구체 스테이지 미지정)
    reason = hasEntitlement ? 'entitled' : 'preview';
  } else if (stageUnit <= FREE_UNIT_LIMIT) {
    canPlay = true;
    reason = 'free_unit';
  } else if (hasEntitlement) {
    canPlay = true;
    reason = 'entitled';
  } else {
    canPlay = false;
    reason = 'payment_required';
  }

  return {
    courseId,
    userId: uid,
    canPlay,
    reason,
    paymentMode: PAYMENT_MODE,
    hasEntitlement,
    entitlementType: active ? active.type : null,
    expiresAt: active ? active.expiresAt : null,
    freeUnitLimit: FREE_UNIT_LIMIT
  };
}

/**
 * 테스트(모의) 결제로 이용권 발급.
 * 이미 유효한 이용권이 있으면 중복 구매를 막는다.
 */
function purchase(courseId, userId = 'anonymous', plan = 'course_pass', opts = {}) {
  if (!courseId) {
    const err = new Error('courseId가 필요합니다.');
    err.statusCode = 400;
    throw err;
  }
  const planDef = PLANS[plan];
  if (!planDef) {
    const err = new Error(`지원하지 않는 이용권 종류입니다: ${plan}`);
    err.statusCode = 400;
    throw err;
  }
  const uid = String(userId || 'anonymous');
  const now = opts.now || Date.now();

  // 중복 구매 방지
  if (findActiveEntitlement(courseId, uid, now)) {
    const err = new Error('이미 이용권이 있어요.');
    err.statusCode = 409;
    err.code = 'already_entitled';
    throw err;
  }

  // 모의 결제 실패 주입(테스트용): opts.simulateFailure 가 true면 실패 처리
  if (opts.simulateFailure) {
    const err = new Error('테스트 결제가 실패했습니다.');
    err.statusCode = 402;
    err.code = 'payment_failed';
    throw err;
  }

  const createdAt = new Date(now).toISOString();
  const expiresAt =
    planDef.type === 'subscription'
      ? new Date(now + planDef.days * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const entitlement = {
    id: crypto.randomUUID(),
    courseId,
    userId: uid,
    plan,
    type: planDef.type,
    label: planDef.label,
    price: planDef.price,
    paymentMode: PAYMENT_MODE,
    createdAt,
    expiresAt
  };

  const list = readStore();
  list.push(entitlement);
  writeStore(list);

  return { ok: true, entitlement };
}

module.exports = {
  getAccess,
  purchase,
  findActiveEntitlement,
  PLANS,
  FREE_UNIT_LIMIT,
  PAYMENT_MODE
};
