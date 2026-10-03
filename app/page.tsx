"use client";
// 첫 화면: 가입·로그인, 내 과목 목록, 새 과목, 참여 코드로 들어가기 (FR-01)
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { api, ApiError } from "@/lib/api-client";

type Course = {
  id: string;
  title: string;
  joinCode: string;
  role: string;
  totalStages: number;
  clearedStages: number;
  stars: number;
  hasAccess: boolean;
};

export default function Home() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => setState(data.session ? "in" : "out"));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setState(s ? "in" : "out"));
    return () => data.subscription.unsubscribe();
  }, []);
  if (state === "loading") return <p className="text-[var(--muted)]">불러오는 중…</p>;
  return state === "out" ? <AuthForm /> : <CourseList />;
}

function AuthForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") await api("/api/auth/signup", { email, password });
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw new Error("이메일 또는 비밀번호가 맞지 않아요");
    } catch (err) {
      setError(err instanceof Error ? err.message : "잠시 후 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">교안 PDF로 시험 범위를 한 스테이지씩</h1>
        <p className="text-[var(--muted)]">
          교안을 올리고 내 AI에게 문제를 만들게 하면, 쉬운 개념부터 5문제씩 풀며 시험 범위를 끝까지 확인할 수 있어요.
        </p>
      </div>
      <form onSubmit={submit} className="card space-y-3">
        <div className="flex gap-2">
          <button type="button" className={`btn ${mode === "login" ? "" : "btn-ghost"}`} onClick={() => setMode("login")}>
            로그인
          </button>
          <button type="button" className={`btn ${mode === "signup" ? "" : "btn-ghost"}`} onClick={() => setMode("signup")}>
            가입
          </button>
        </div>
        <label className="block space-y-1">
          <span className="text-sm">이메일</span>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">비밀번호 {mode === "signup" && <span className="text-[var(--muted)]">(6자 이상)</span>}</span>
          <input className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="msg-error text-sm">{error}</p>}
        <button className="btn w-full" disabled={busy}>
          {busy ? "확인 중…" : mode === "login" ? "로그인" : "가입하고 시작하기"}
        </button>
        {mode === "signup" && <p className="text-xs text-[var(--muted)]">확인 메일 없이 바로 시작해요.</p>}
      </form>
    </section>
  );
}

function CourseList() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [formError, setFormError] = useState("");

  async function load() {
    setError("");
    try {
      const { courses } = await api<{ courses: Course[] }>("/api/courses");
      setCourses(courses);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "과목을 불러오지 못했어요");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setFormError("");
    try {
      const { course } = await api<{ course: { id: string } }>("/api/courses", { title });
      router.push(`/courses/${course.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "과목을 만들지 못했어요");
      setBusy("");
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy("join");
    setFormError("");
    try {
      const { courseId } = await api<{ courseId: string }>("/api/courses/join", { code });
      router.push(`/courses/${courseId}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "참여하지 못했어요");
      setBusy("");
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">내 과목</h1>
        <button className="btn btn-ghost text-sm" onClick={() => supabaseBrowser().auth.signOut()}>
          로그아웃
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <form onSubmit={create} className="card space-y-2">
          <span className="font-semibold">새 과목</span>
          <input className="input" placeholder="예: 운영체제 중간고사" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn w-full" disabled={!title.trim() || busy !== ""}>
            {busy === "create" ? "만드는 중…" : "만들기"}
          </button>
        </form>
        <form onSubmit={join} className="card space-y-2">
          <span className="font-semibold">참여 코드로 들어가기</span>
          <input className="input uppercase" placeholder="친구에게 받은 6자리 코드" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn btn-ghost w-full" disabled={!code.trim() || busy !== ""}>
            {busy === "join" ? "확인 중…" : "들어가기"}
          </button>
        </form>
      </div>
      {formError && <p className="msg-error">{formError}</p>}

      {error && (
        <div className="card space-y-2">
          <p className="msg-error">{error}</p>
          <button className="btn btn-ghost" onClick={load}>
            다시 불러오기
          </button>
        </div>
      )}
      {!error && courses === null && <p className="text-[var(--muted)]">불러오는 중…</p>}
      {courses?.length === 0 && (
        <p className="card text-[var(--muted)]">아직 과목이 없어요. 새 과목을 만들거나 친구에게 받은 참여 코드를 넣어 보세요.</p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {courses?.map((c) => {
          const percent = c.totalStages ? Math.round((c.clearedStages / c.totalStages) * 100) : 0;
          return (
            <li key={c.id}>
              <a href={`/courses/${c.id}`} className="card block space-y-2 hover:border-[var(--accent)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{c.title}</span>
                  {c.hasAccess && <span className="rounded-full bg-[var(--ok)] px-2 py-0.5 text-xs text-white">이용 중</span>}
                </div>
                <div className="h-2 rounded-full bg-[var(--line)]">
                  <div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${percent}%` }} />
                </div>
                <p className="text-sm text-[var(--muted)]">
                  진행 {percent}% · 스테이지 {c.clearedStages}/{c.totalStages} · 별 {c.stars}개
                </p>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
