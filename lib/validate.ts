// 요청 본문 검사. 타입 단언은 실행 중 검사가 아니므로, 객체인지·필드가 문자열/정수인지 먼저 확인하고
// 틀리면 InvalidInput(→ 400 invalid)을 던진다. 의존성이 없어 단위 테스트에서 바로 불러온다.
export class InvalidInput extends Error {}

export type Body = Record<string, unknown>;

export function asObject(v: unknown): Body {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new InvalidInput("요청 형식이 올바르지 않아요");
  return v as Body;
}

type StrOpts = { label: string; min?: number; max?: number; optional?: boolean };

export function str(body: Body, key: string, { label, min = 1, max = 10_000, optional = false }: StrOpts): string {
  const v = body[key];
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (optional) return "";
    throw new InvalidInput(`${label}을(를) 입력해 주세요`);
  }
  if (typeof v !== "string") throw new InvalidInput(`${label} 형식이 올바르지 않아요`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new InvalidInput(`${label}은(는) ${min}~${max}자로 적어 주세요`);
  return t;
}

type IntOpts = { label: string; min?: number; max?: number; optional?: boolean };

export function int(body: Body, key: string, { label, min = -Infinity, max = Infinity, optional = false }: IntOpts): number | null {
  const v = body[key];
  if (v === undefined || v === null) {
    if (optional) return null;
    throw new InvalidInput(`${label}을(를) 입력해 주세요`);
  }
  if (typeof v !== "number" || !Number.isInteger(v)) throw new InvalidInput(`${label} 형식이 올바르지 않아요`);
  if (v < min || v > max) throw new InvalidInput(`${label} 범위가 올바르지 않아요`);
  return v;
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], label: string): T {
  const v = body[key];
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new InvalidInput(`${label}을(를) 골라 주세요`);
  return v as T;
}

export function arrayOf<T>(body: Body, key: string, label: string, max: number, item: (v: unknown, i: number) => T): T[] {
  const v = body[key];
  if (!Array.isArray(v)) throw new InvalidInput(`${label} 형식이 올바르지 않아요`);
  if (v.length > max) throw new InvalidInput(`${label}은(는) ${max}개까지 보낼 수 있어요`);
  return v.map(item);
}
