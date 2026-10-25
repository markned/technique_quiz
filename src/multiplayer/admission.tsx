import { useEffect, useRef } from "react";
import { loadScript, type useAdmission } from "./useAdmission";
export function AdmissionPanel({ admission }: { admission: ReturnType<typeof useAdmission> }) {
  const target = useRef<HTMLDivElement>(null);
  const solve = useRef(admission.solve);
  solve.current = admission.solve;
  useEffect(() => {
    if (!admission.sitekey || !target.current) return;
    let disposed = false;
    let id: string | undefined;
    void loadScript()
      .then(() => {
        if (disposed || !target.current) return;
        id = window.turnstile!.render(target.current, {
          sitekey: admission.sitekey,
          action: "room_access",
          theme: "dark",
          callback: (token: string) => {
            void solve.current(token).catch(() => {
              if (id) window.turnstile?.reset(id);
            });
          },
          "expired-callback": () => {
            if (id) window.turnstile?.reset(id);
          },
          "error-callback": () => {
            if (id) window.turnstile?.reset(id);
          },
        });
      })
      .catch(() => admission.retry());
    return () => {
      disposed = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [admission.sitekey]);
  return (
    <main className="app-shell rules-screen-shell">
      <section className="rules-screen-card">
        <h1>Подключение к игре</h1>
        <p>Проверяем, что подключается человек.</p>
        <div ref={target} />
        {admission.error ? <p role="alert">{admission.error}</p> : null}
        <button className="btn" onClick={admission.retry}>
          Повторить
        </button>
        <a href="/#multiplayer">← Назад</a>
      </section>
    </main>
  );
}
