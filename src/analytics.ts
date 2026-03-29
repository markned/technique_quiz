/**
 * GA4 и Яндекс.Метрика: при сборке без `.env` в production подставляются значения по умолчанию.
 * Переопределение — `VITE_GA_MEASUREMENT_ID` и `VITE_YM_COUNTER_ID` (см. `.env.example`).
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    ym?: (id: number, method: string, ...args: unknown[]) => void;
  }
}

const PROD_GA_MEASUREMENT_ID = "G-6F2LVVCEY6";
const PROD_YM_COUNTER_ID = 108296594;

function resolveGaMeasurementId(): string | undefined {
  const v = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
  if (v) return v;
  if (import.meta.env.PROD) return PROD_GA_MEASUREMENT_ID;
  return undefined;
}

function resolveYmCounterId(): number | undefined {
  const raw = import.meta.env.VITE_YM_COUNTER_ID?.trim();
  if (raw) {
    const n = Number(raw.replace(/\D/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (import.meta.env.PROD) return PROD_YM_COUNTER_ID;
  return undefined;
}

function initGoogleAnalytics(measurementId: string): void {
  window.dataLayer = window.dataLayer ?? [];
  function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  }
  (window as unknown as { gtag: typeof gtag }).gtag = gtag;

  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(s);

  gtag("js", new Date());
  gtag("config", measurementId);
}

function initYandexMetrika(counterId: number): void {
  const initOptions = {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: "dataLayer",
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  };

  const tagUrl = `https://mc.yandex.ru/metrika/tag.js?id=${counterId}`;
  const inline = document.createElement("script");
  inline.textContent = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script",${JSON.stringify(tagUrl)},"ym");
ym(${counterId},"init",${JSON.stringify(initOptions)});`;
  document.head.appendChild(inline);
}

export function initAnalytics(): void {
  if (typeof window === "undefined") return;

  const ga = resolveGaMeasurementId();
  if (ga) {
    initGoogleAnalytics(ga);
  }

  const ymId = resolveYmCounterId();
  if (ymId !== undefined) {
    initYandexMetrika(ymId);
  }
}
