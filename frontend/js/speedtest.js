/**
 * Client-side speed test against this server's own /api/speedtest/*
 * endpoints. Follows the same methodology real speed test services use
 * (Speedtest.net/fast.com), not a naive single-request timing:
 *
 *  1. Ping measured *before* the load test, via several sequential
 *     round trips to an endpoint that does nothing — measuring latency
 *     while the link is idle, not while it's saturated by the load test.
 *  2. Download/upload use several PARALLEL connections (a single TCP
 *     stream often can't saturate a fast link — window scaling and
 *     congestion control limit one stream's throughput well below the
 *     link's real capacity).
 *  3. Tests are DURATION-based, not size-based: run for a fixed window
 *     and see how many bytes moved, rather than requesting N bytes and
 *     waiting for them to finish (which either finishes almost
 *     instantly on a fast link, measuring nothing meaningful, or drags
 *     on forever on a slow one).
 *  4. The first second of each test is discarded from the throughput
 *     calculation — TCP's slow-start ramp means early throughput
 *     under-reports the link's steady-state speed.
 */
(function () {
  // ---- Dark/light theme toggle ----
  // Explicit user choice, not prefers-color-scheme — stored so it
  // survives a reload. Defaults to dark (this app's original look) if
  // nothing was chosen yet or localStorage isn't available (private
  // browsing, etc. — falls back to the default rather than breaking).
  const THEME_KEY = "nettapesh-theme";
  const themeToggleBtn = document.getElementById("themeToggle");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggleBtn.querySelectorAll(".theme-toggle-half").forEach((half) => {
      half.classList.toggle("active", half.dataset.themeChoice === theme);
    });
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      // best-effort — theme just won't persist across reloads
    }
  }

  applyTheme(getStoredTheme() === "light" ? "light" : "dark");
  themeToggleBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    setStoredTheme(next);
    refreshChartTheme();
  });

  // ---- Language (fa/en) ----
  // A real switch, not decoration: every static string in the page
  // carries a data-i18n (textContent) or data-i18n-aria (aria-label)
  // key, applied by applyLanguage() below; dynamically-generated
  // strings (results overlay, ping log rows, chart labels, status
  // messages) all go through t() at the point they're built instead of
  // being hardcoded Persian, so switching languages mid-session
  // updates them too, not just what was on screen at load time.
  const LANG_KEY = "nettapesh-lang";
  const I18N = {
    fa: {
      "lang.name": "فارسی",
      "tab.speedtest": "تست سرعت",
      "tab.continuousPing": "تست پیوسته",
      "stat.download": "دانلود",
      "stat.upload": "آپلود",
      "mini.ping": "پینگ",
      "mini.jitter": "جیتر",
      "start.button": "شروع تست",
      "history.title": "تاریخچه",
      "range.day": "روز",
      "range.week": "هفته",
      "history.download": "دانلود (Mbps)",
      "history.upload": "آپلود (Mbps)",
      "history.empty": "هنوز تستی ثبت نشده — یه تست سرعت بزن تا اینجا نمودارش رو ببینی.",
      "history.showPing": "پینگ",
      "pingtab.start": "شروع",
      "pingtab.stop": "توقف",
      "ping.rounds": "دورها",
      "ping.avgPing": "میانگین پینگ",
      "ping.avgDown": "میانگین دانلود",
      "ping.avgUp": "میانگین آپلود",
      "ping.empty": "دکمه‌ی شروع رو بزنید تا دورهای پشت‌سرهم پینگ/دانلود/آپلود شروع بشه.",
      "ping.pingLabel": "پینگ",
      "ping.error": "خطا در اتصال",
      "ping.chartTitle": "روند سرعت در طول تست",
      "ping.chartRound": "دور",
      "ping.chartDown": "دانلود",
      "ping.chartUp": "آپلود",
      "footer.desc": "اسپیدتست اینترنت خودمیزبان — بدون نصب، بدون حساب کاربری. پینگ، دانلود و آپلود مستقیماً در برابر همین سرور اندازه‌گیری می‌شه.",
      "footer.github": "مخزن GitHub",
      "footer.resume": "رزومه‌ی سازنده",
      "footer.copyright": "© {year} netTAPESH — ساخته‌شده با FastAPI و جاوااسکریپت خالص.",
      "theme.toggle": "تغییر تم روشن/تیره",
      "results.close": "بستن",
      "results.download": "دانلود Mbps",
      "results.upload": "آپلود Mbps",
      "results.pingMs": "پینگ ms",
      "results.jitterMs": "جیتر ms",
      "results.connection": "اتصال",
      "results.connectionValue": "چندگانه (۴ کانکشن موازی)",
      "results.isp": "ارائه‌دهنده",
      "results.ip": "آی‌پی شما",
      "results.location": "لوکیشن",
      "results.share": "اشتراک‌گذاری نتیجه",
      "share.text": "نتیجه‌ی تست سرعت اینترنتم با netTAPESH: ⬇ {download} {unit} دانلود، ⬆ {upload} {unit} آپلود، پینگ {ping} ms",
      "share.copied": "کپی شد!",
      "share.copyFailed": "کپی نشد",
      "plan.prompt": "سرعت پلن اینترنتت رو وارد کن تا مقایسه کنیم",
      "plan.placeholder": "مثلاً ۵۰",
      "plan.save": "ثبت",
      "plan.edit": "ویرایش سرعت پلن",
      "plan.resultText": "٪{percent} از سرعت پلن ({planSpeed} Mbps)",
      "quality.browsing": "وب‌گردی",
      "quality.gaming": "گیم آنلاین",
      "quality.streaming": "استریم ویدیو",
      "quality.videocall": "تماس تصویری",
      "testing.ping": "در حال تست پینگ…",
      "testing.download": "در حال تست دانلود…",
      "testing.upload": "در حال تست آپلود…",
      "result.done": "تست در {date} انجام شد",
      "result.error": "خطا در اجرای تست — دوباره امتحان کن.",
      "result.last": "آخرین تست: {date}",
      "glossary.title": "اصطلاحات تست سرعت",
      "glossary.pingTerm": "پینگ (Ping)",
      "glossary.pingDesc": "مدت‌زمانی که طول می‌کشه یه بسته‌ی داده از دستگاهت به سرور برسه و جوابش برگرده، بر حسب میلی‌ثانیه (ms). عدد کمتر یعنی واکنش سریع‌تر — برای بازی آنلاین و تماس تصویری اهمیت زیادی داره.",
      "glossary.jitterTerm": "جیتر (Jitter)",
      "glossary.jitterDesc": "میزان نوسان پینگ بین درخواست‌های پشت‌سرهم. جیتر بالا یعنی اتصال ناپایداره حتی اگه میانگین پینگ خوب باشه — معمولاً همون چیزیه که باعث قطع‌وصل شدن صدا یا تصویر توی یه تماس زنده می‌شه.",
      "glossary.downloadTerm": "دانلود (Download)",
      "glossary.downloadDesc": "سرعت دریافت داده از اینترنت به دستگاهت، بر حسب مگابیت بر ثانیه (Mbps). این عددیه که روی باز شدن سایت‌ها، پخش ویدیو، و دانلود فایل بیشترین تأثیر رو داره.",
      "glossary.uploadTerm": "آپلود (Upload)",
      "glossary.uploadDesc": "سرعت ارسال داده از دستگاهت به اینترنت. برای آپلود فایل، استریم زنده، و کیفیت تصویر توی تماس ویدیویی مهمه — روی اکثر اتصال‌های خانگی معمولاً به‌مراتب کمتر از سرعت دانلوده.",
      "faq.title": "سوالات متداول",
      "faq.q1": "تست سرعت اینترنت netTAPESH چطور کار می‌کنه؟",
      "faq.a1": "برخلاف بیشتر ابزارهای تست سرعت که به سرورهای یه شرکت دیگه وصل می‌شن، netTAPESH پینگ، دانلود و آپلود رو مستقیماً در برابر همین سروری که الان بازش کردی اندازه‌گیری می‌کنه — بدون نصب برنامه و بدون ساختن حساب کاربری.",
      "faq.q2": "چرا عدد پینگ توی این تست با اپ‌های دیگه فرق داره؟",
      "faq.a2": "پینگ همیشه به مقصد بستگی داره — هر سرویس تست سرعت به یه سرور متفاوت وصل می‌شه، پس عددهای پینگ بین ابزارهای مختلف طبیعتاً یکی نیستن؛ این نشونه‌ی خرابی نیست.",
      "faq.q3": "آیا استفاده از netTAPESH رایگانه؟",
      "faq.a3": "بله، کاملاً رایگان و بدون نیاز به ثبت‌نام یا نصب اپلیکیشنه.",
      "faq.q4": "تست پیوسته چیه؟",
      "faq.a4": "به‌جای یه تست یک‌باره، پینگ، دانلود و آپلود رو به‌صورت پشت‌سرهم و زنده اندازه‌گیری می‌کنه — برای دیدن نوسان و پایداری اتصال در طول زمان (مثلاً حین بازی آنلاین یا تماس تصویری) مفیده.",
      "faq.q5": "چند بار می‌شه تست گرفت؟",
      "faq.a5": "محدودیت خاصی برای استفاده‌ی معمولی نیست؛ فقط برای جلوگیری از سوءاستفاده، تعداد درخواست در دقیقه محدوده.",
    },
    en: {
      "lang.name": "English",
      "tab.speedtest": "Speed Test",
      "tab.continuousPing": "Continuous Test",
      "stat.download": "Download",
      "stat.upload": "Upload",
      "mini.ping": "Ping",
      "mini.jitter": "Jitter",
      "start.button": "Start Test",
      "history.title": "History",
      "range.day": "Day",
      "range.week": "Week",
      "history.download": "Download (Mbps)",
      "history.upload": "Upload (Mbps)",
      "history.empty": "No tests recorded yet — run a speed test to see it charted here.",
      "history.showPing": "Ping",
      "pingtab.start": "Start",
      "pingtab.stop": "Stop",
      "ping.rounds": "Rounds",
      "ping.avgPing": "Avg Ping",
      "ping.avgDown": "Avg Download",
      "ping.avgUp": "Avg Upload",
      "ping.empty": "Click Start to begin continuous ping/download/upload rounds.",
      "ping.pingLabel": "Ping",
      "ping.error": "Connection error",
      "ping.chartTitle": "Speed trend over the test",
      "ping.chartRound": "Round",
      "ping.chartDown": "Download",
      "ping.chartUp": "Upload",
      "footer.desc": "Self-hosted internet speed test — no install, no account. Ping, download, and upload are measured directly against this same server.",
      "footer.github": "GitHub Repo",
      "footer.resume": "Developer's Résumé",
      "footer.copyright": "© {year} netTAPESH — built with FastAPI and vanilla JavaScript.",
      "theme.toggle": "Toggle light/dark theme",
      "results.close": "Close",
      "results.download": "Download Mbps",
      "results.upload": "Upload Mbps",
      "results.pingMs": "Ping ms",
      "results.jitterMs": "Jitter ms",
      "results.connection": "Connection",
      "results.connectionValue": "Multiple (4 parallel connections)",
      "results.isp": "ISP",
      "results.ip": "Your IP",
      "results.location": "Location",
      "results.share": "Share Result",
      "share.text": "My internet speed test result with netTAPESH: ⬇ {download} {unit} down, ⬆ {upload} {unit} up, ping {ping} ms",
      "share.copied": "Copied!",
      "share.copyFailed": "Copy failed",
      "plan.prompt": "Enter your ISP plan's speed to compare",
      "plan.placeholder": "e.g. 50",
      "plan.save": "Save",
      "plan.edit": "Edit plan speed",
      "plan.resultText": "{percent}% of plan speed ({planSpeed} Mbps)",
      "quality.browsing": "Web Browsing",
      "quality.gaming": "Online Gaming",
      "quality.streaming": "Video Streaming",
      "quality.videocall": "Video Chat",
      "testing.ping": "Testing ping…",
      "testing.download": "Testing download…",
      "testing.upload": "Testing upload…",
      "result.done": "Test completed at {date}",
      "result.error": "Test failed — please try again.",
      "result.last": "Last test: {date}",
      "glossary.title": "Speed Test Glossary",
      "glossary.pingTerm": "Ping",
      "glossary.pingDesc": "How long it takes a data packet to travel from your device to the server and back, in milliseconds (ms). Lower is more responsive — this matters a lot for online gaming and video calls.",
      "glossary.jitterTerm": "Jitter",
      "glossary.jitterDesc": "How much ping varies between consecutive requests. High jitter means an unstable connection even when average ping looks fine — it's usually what causes audio or video to break up during a live call.",
      "glossary.downloadTerm": "Download",
      "glossary.downloadDesc": "How fast data reaches your device from the internet, in megabits per second (Mbps). This is the number that matters most for loading pages, streaming video, and downloading files.",
      "glossary.uploadTerm": "Upload",
      "glossary.uploadDesc": "How fast data goes from your device to the internet. Matters for uploading files, live streaming, and video call quality — on most home connections it's usually well below download speed.",
      "faq.title": "Frequently Asked Questions",
      "faq.q1": "How does the netTAPESH speed test work?",
      "faq.a1": "Unlike most speed test tools that connect to another company's servers, netTAPESH measures ping, download, and upload directly against the same server you're on right now — no app to install, no account to create.",
      "faq.q2": "Why is the ping different from other apps?",
      "faq.a2": "Ping always depends on the destination — every speed test service connects to a different server, so ping numbers naturally differ between tools. That's not a malfunction.",
      "faq.q3": "Is netTAPESH free to use?",
      "faq.a3": "Yes, completely free — no signup and nothing to install.",
      "faq.q4": "What is the continuous test?",
      "faq.a4": "Instead of a single one-off test, it measures ping, download, and upload back-to-back in real time — useful for seeing how your connection fluctuates over time (e.g. during online gaming or a video call).",
      "faq.q5": "How many times can I run a test?",
      "faq.a5": "No particular limit for normal use — request rates are only capped to prevent abuse.",
    },
  };

  let currentLang = "fa";

  function t(key, vars) {
    const dict = I18N[currentLang] || I18N.fa;
    let str = dict[key] || I18N.fa[key] || key;
    if (vars) {
      // replaceAll, not replace — share.text uses {unit} twice (once
      // for download, once for upload); a single .replace() would only
      // fill in the first occurrence and leave the literal "{unit}" in
      // the second.
      for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
    }
    return str;
  }

  function localeName() {
    return currentLang === "fa" ? "fa-IR" : "en-US";
  }

  const langSwitcherBtn = document.getElementById("langSwitcherBtn");
  const langSwitcherLabelEl = document.getElementById("langSwitcherLabel");
  const langMenuEl = document.getElementById("langMenu");

  function getStoredLang() {
    try {
      return localStorage.getItem(LANG_KEY);
    } catch (e) {
      return null;
    }
  }
  function setStoredLang(lang) {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      // best-effort — language just won't persist across reloads
    }
  }

  function renderFooterBottom() {
    document.getElementById("footerBottom").innerHTML =
      t("footer.copyright", { year: `<span id="footerYear">${new Date().getFullYear()}</span>` });
  }

  // applyLanguage() references pingLoopToggleBtn/pingLoopRunning/
  // historyChartDown/loadHistory even though they're declared further
  // down in this same closure — safe because this function's BODY only
  // runs when called (the initial call and the click handler below are
  // both after the whole script has finished executing top to bottom),
  // not at definition time, so those bindings are long since
  // initialized by then.
  function applyLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    // Deliberately NOT toggling dir with the language — an earlier
    // version flipped the whole page rtl/ltr per language, which
    // physically moved every element (tabs, header controls, gauge
    // side info, ...) to the opposite side on every switch. Per
    // feedback, layout position should stay fixed; only the text
    // changes. The layout stays RTL always, English text just reads
    // right-aligned within it rather than the page mirroring.
    langSwitcherLabelEl.textContent = t("lang.name");
    langMenuEl.querySelectorAll(".lang-menu-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.lang === lang);
    });

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
    });

    // The continuous-ping start/stop button's label depends on running
    // state too, not just language — re-derive rather than assume.
    pingLoopBtnLabelEl.textContent = pingLoopRunning ? t("pingtab.stop") : t("pingtab.start");

    renderFooterBottom();
    updateNowStamp();
    refreshChartTheme();
    loadHistory(document.querySelector('.range-toggle[data-target="history"] button.active').dataset.range);
    // Re-render (not just re-theme) so round labels/legend switch
    // language too — only matters if a finished run's chart is showing.
    if (!pingLoopChartBlockEl.hidden) renderPingLoopChart();
  }

  function closeLangMenu() {
    langMenuEl.hidden = true;
    langSwitcherBtn.setAttribute("aria-expanded", "false");
  }

  langSwitcherBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = langMenuEl.hidden;
    langMenuEl.hidden = !opening;
    langSwitcherBtn.setAttribute("aria-expanded", String(opening));
  });

  langMenuEl.querySelectorAll(".lang-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      applyLanguage(item.dataset.lang);
      setStoredLang(item.dataset.lang);
      closeLangMenu();
    });
  });

  document.addEventListener("click", (e) => {
    if (!langMenuEl.hidden && !e.target.closest("#langSwitcher")) closeLangMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLangMenu();
  });

  const PING_SAMPLES = 10;
  const PARALLEL_CONNECTIONS = 4;
  const TEST_DURATION_MS = 8000;
  const WARMUP_MS = 1000;
  const UPDATE_INTERVAL_MS = 200;

  const runBtn = document.getElementById("runBtn");
  const runBtnLabel = document.getElementById("runBtnLabel");
  const testPhaseEl = document.getElementById("testPhase");
  const testProgressTrackEl = document.getElementById("testProgressTrack");
  const testProgressBarEl = document.getElementById("testProgressBar");

  // Sets the real per-phase progress bar's fill — `fraction` is always
  // derived from actual elapsed time or completed samples (see the
  // call sites in measurePing()/runParallelTest() below), never a
  // fake/looping animation. Clamped since a slow final tick can land
  // fractionally past 1 right as a phase's timer/count finishes.
  function setTestProgress(fraction) {
    testProgressBarEl.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }
  const rPing = document.getElementById("rPing");
  const rJitter = document.getElementById("rJitter");
  const rDown = document.getElementById("rDown");
  const rUp = document.getElementById("rUp");
  const rDownUnit = document.getElementById("rDownUnit");
  const rUpUnit = document.getElementById("rUpUnit");
  const unitToggle = document.getElementById("unitToggle");
  const resultMetaEl = document.getElementById("resultMeta");
  const gaugeLiveValue = document.getElementById("gaugeLiveValue");
  const speedoWrapEl = document.getElementById("speedoWrap");
  const nowStampEl = document.getElementById("nowStamp");
  const ispNameEl = document.getElementById("ispName");
  const locationNameEl = document.getElementById("locationName");
  const ispInfoEl = document.getElementById("ispInfo");
  const locationInfoEl = document.getElementById("locationInfo");
  const resultsOverlay = document.getElementById("resultsOverlay");
  const pageHeaderEl = document.getElementById("pageHeader");
  const tabNavEl = document.getElementById("tabNav");
  const pageMainEl = document.getElementById("pageMain");
  const siteFooterEl = document.getElementById("siteFooter");
  const resultsCloseBtn = document.getElementById("resultsCloseBtn");
  const resDown = document.getElementById("resDown");
  const resUp = document.getElementById("resUp");
  const resPing = document.getElementById("resPing");
  const resJitter = document.getElementById("resJitter");
  const resIsp = document.getElementById("resIsp");
  const resIp = document.getElementById("resIp");
  const resLocation = document.getElementById("resLocation");
  const resultsQualityRow = document.getElementById("resultsQualityRow");
  const resultsTimestampEl = document.getElementById("resultsTimestamp");
  const resultsShareBtn = document.getElementById("resultsShareBtn");
  const planInputForm = document.getElementById("planInputForm");
  const planSpeedInput = document.getElementById("planSpeedInput");
  const planResultRow = document.getElementById("planResultRow");
  const planResultText = document.getElementById("planResultText");
  const planEditBtn = document.getElementById("planEditBtn");

  // ---- Clock (top-right timestamp, like Ookla's) ----
  function updateNowStamp() {
    nowStampEl.textContent = new Date().toLocaleString(localeName(), {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  updateNowStamp();
  setInterval(updateNowStamp, 30000);

  // ---- ISP / location (fetched once — by IP, server-side, see
  // backend/api/routes.py speedtest_client_info) ----
  // Cached in module scope (not just written into the DOM) because the
  // results overlay needs the same isp/location/ip values again when a
  // test finishes, without a second round trip.
  let clientInfo = { isp: null, location: null, ip: null };

  async function loadClientInfo() {
    try {
      const res = await fetch("/api/speedtest/client-info");
      const data = await res.json();
      clientInfo = data;
      ispNameEl.textContent = data.isp || "—";
      locationNameEl.textContent = data.location || "—";
    } catch (e) {
      // best-effort — leave the "—" placeholders
    }
  }
  loadClientInfo();

  // ---- Results overlay (full-screen summary shown after a test
  // finishes, styled after a real Speedtest.net results screen) ----
  // Connection-quality "star" ratings aren't something this app can
  // measure directly (that needs real gaming/streaming traffic, which
  // is what Ookla's apps actually do) — this is a documented heuristic
  // approximation from ping/jitter/download/upload, not a measured
  // score, so it's presented as illustrative rather than authoritative.
  const QUALITY_CATEGORIES = [
    {
      key: "browsing",
      labelKey: "quality.browsing",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18" stroke-linecap="round"/></svg>',
      score: ({ ping, download }) => scoreFromThresholds(download, [1, 5, 15, 30]) - (ping > 150 ? 1 : 0),
    },
    {
      key: "gaming",
      labelKey: "quality.gaming",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 12h.01M18.5 10h.01" stroke-linecap="round"/></svg>',
      score: ({ ping, jitter }) => scoreFromThresholds(150 - ping, [0, 50, 90, 120]) - (jitter > 20 ? 1 : 0),
    },
    {
      key: "streaming",
      labelKey: "quality.streaming",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="15" height="14" rx="2"/><path d="M17 8l5-3v14l-5-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      score: ({ download }) => scoreFromThresholds(download, [2, 5, 15, 25]),
    },
    {
      key: "videocall",
      labelKey: "quality.videocall",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="15" height="12" rx="2"/><path d="M17 10l5-3v10l-5-3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="11" r="2.2"/></svg>',
      score: ({ ping, jitter, upload }) => scoreFromThresholds(Math.min(upload, 100 - ping), [0, 5, 15, 25]) - (jitter > 30 ? 1 : 0),
    },
  ];

  // Maps a value against ascending thresholds to a 1-5 dot score —
  // below the first threshold is 1, at/above the last is 5.
  function scoreFromThresholds(value, thresholds) {
    let score = 1;
    for (const t of thresholds) {
      if (value >= t) score++;
    }
    return Math.max(1, Math.min(5, score));
  }

  function renderQualityDots(score) {
    return Array.from({ length: 5 }, (_, i) =>
      `<span class="results-quality-dot${i < score ? " filled" : ""}"></span>`
    ).join("");
  }

  // ---- ISP-plan comparison (optional, fully client-side) ----
  // The plan speed a visitor enters is never sent to the server or
  // attached to any test result — it only ever lives in this
  // browser's localStorage. See the HTML comment on #planCompareBlock
  // for why that matters (this app's history table has no auth, so
  // anything that DID reach the server there becomes effectively
  // public).
  const PLAN_SPEED_STORAGE_KEY = "nettapesh_plan_mbps";

  function getPlanSpeed() {
    const raw = localStorage.getItem(PLAN_SPEED_STORAGE_KEY);
    const value = raw == null ? null : parseFloat(raw);
    return value != null && isFinite(value) && value > 0 ? value : null;
  }

  function setPlanSpeed(value) {
    try {
      localStorage.setItem(PLAN_SPEED_STORAGE_KEY, String(value));
    } catch (e) {
      // Private-browsing/storage-disabled — the comparison just won't
      // persist across a reload; not worth surfacing an error for.
    }
  }

  // Compares against DOWNLOAD specifically — that's the number ISPs
  // actually advertise ("50 Mbps internet"), not upload.
  function renderPlanCompare(downloadMbps) {
    const planSpeed = getPlanSpeed();
    if (planSpeed == null) {
      planInputForm.hidden = false;
      planResultRow.hidden = true;
      return;
    }
    const percent = Math.round((downloadMbps / planSpeed) * 100);
    // Thresholds are deliberately generous — real-world Wi-Fi/overhead
    // losses mean even a healthy connection rarely hits 100% of the
    // advertised number, so treating anything below it as "bad" would
    // just be alarming for no reason.
    const color = percent >= 80 ? "--green" : percent >= 50 ? "--amber" : "--red";
    planResultText.textContent = t("plan.resultText", { percent, planSpeed });
    planResultText.style.color = `var(${color})`;
    planInputForm.hidden = true;
    planResultRow.hidden = false;
  }

  planInputForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = parseFloat(planSpeedInput.value);
    if (!isFinite(value) || value <= 0) return;
    setPlanSpeed(value);
    if (lastShownResult) renderPlanCompare(lastShownResult.download_mbps);
  });

  planEditBtn.addEventListener("click", () => {
    planSpeedInput.value = getPlanSpeed() ?? "";
    planResultRow.hidden = true;
    planInputForm.hidden = false;
    planSpeedInput.focus();
  });

  // Kept in module scope (not just the DOM) so shareResult() below has
  // the raw numbers to build its share text from — the DOM only has the
  // already-formatted (unit-converted, rounded) display strings.
  let lastShownResult = null;

  function showResultsOverlay(result) {
    lastShownResult = result;
    renderPlanCompare(result.download_mbps);
    resDown.textContent = formatSpeed(result.download_mbps);
    resUp.textContent = formatSpeed(result.upload_mbps);
    resPing.textContent = result.ping_ms.toFixed(0);
    resJitter.textContent = result.jitter_ms.toFixed(1);
    resIsp.textContent = clientInfo.isp || "—";
    resIp.textContent = clientInfo.ip || "—";
    resLocation.textContent = clientInfo.location || "—";
    resultsTimestampEl.textContent = t("result.done", { date: new Date().toLocaleString(localeName()) });

    resultsQualityRow.innerHTML = QUALITY_CATEGORIES.map((cat) => {
      const score = cat.score({
        ping: result.ping_ms,
        jitter: result.jitter_ms,
        download: result.download_mbps,
        upload: result.upload_mbps,
      });
      return `
        <div class="results-quality-item">
          <span class="icon">${cat.icon}</span>
          <span class="results-quality-label">${t(cat.labelKey)}</span>
          <span class="results-quality-dots">${renderQualityDots(score)}</span>
        </div>
      `;
    }).join("");

    openResultsOverlay();
  }

  // Two earlier approaches (position: fixed + its own overflow-y: auto,
  // then that plus locking html/body scroll) both still ended up with
  // some kind of nested/duplicate scroll behavior depending on the
  // browser. Simplest fix, and literally what was asked for: don't
  // give the overlay its own scroll container at all. Hide the rest of
  // the page's content (header, tab nav, <main id="pageMain">, footer)
  // while it's open, so the results overlay is the only thing on the
  // page — sized by its own content, scrolled (only if actually taller
  // than the window) by nothing but the browser's own default page
  // scrollbar. window.scrollTo(0, 0) resets the page's scroll position
  // itself, since whatever the user had scrolled to on the main page
  // before starting a test would otherwise carry over.
  function openResultsOverlay() {
    pageHeaderEl.hidden = true;
    tabNavEl.hidden = true;
    pageMainEl.hidden = true;
    siteFooterEl.hidden = true;
    resultsOverlay.hidden = false;
    window.scrollTo(0, 0);
  }

  function closeResultsOverlay() {
    resultsOverlay.hidden = true;
    pageHeaderEl.hidden = false;
    tabNavEl.hidden = false;
    pageMainEl.hidden = false;
    siteFooterEl.hidden = false;
  }

  resultsCloseBtn.addEventListener("click", () => {
    closeResultsOverlay();
    // The main start button hides once a test completes (see runTest())
    // — closing the overlay without starting another test is the one
    // way back to it, otherwise there'd be no way to test again from
    // the main page at all.
    runBtn.hidden = false;
  });

  const resultsRestartBtn = document.getElementById("resultsRestartBtn");
  resultsRestartBtn.addEventListener("click", () => {
    closeResultsOverlay();
    runTest();
  });

  // navigator.share() hands the OS its own share sheet (Telegram,
  // WhatsApp, X/Twitter, "copy link", whatever's installed) — the
  // right behavior on the mobile browsers that actually support it.
  // Desktop browsers mostly don't, so there the fallback is copying
  // the same text to the clipboard and flashing the button to confirm
  // it worked, rather than silently doing nothing.
  async function shareResult() {
    if (!lastShownResult) return;
    // Unit label isn't translated anywhere else in the app either (see
    // the Mbps/MB/s toggle buttons) — same plain string in fa and en.
    const text = t("share.text", {
      download: formatSpeed(lastShownResult.download_mbps),
      upload: formatSpeed(lastShownResult.upload_mbps),
      ping: lastShownResult.ping_ms.toFixed(0),
      unit: currentUnit === "MBps" ? "MB/s" : "Mbps",
    });
    const shareData = { title: "netTAPESH", text, url: location.origin };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (e) {
        // AbortError = the user closed the share sheet without picking
        // anything — not a failure, nothing to fall back to for.
        if (e && e.name === "AbortError") return;
        // Any other failure (share API present but this particular
        // data type unsupported, etc.) — fall through to the clipboard
        // fallback below instead of leaving the click looking like it
        // did nothing.
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${location.origin}`);
      flashShareButton("share.copied");
    } catch (e) {
      flashShareButton("share.copyFailed");
    }
  }

  let shareFlashTimer = null;
  function flashShareButton(messageKey) {
    const labelEl = resultsShareBtn.querySelector("span");
    clearTimeout(shareFlashTimer);
    labelEl.textContent = t(messageKey);
    resultsShareBtn.classList.add("copied");
    shareFlashTimer = setTimeout(() => {
      // Re-read "results.share" rather than restoring a captured
      // string. Currently the language switcher lives in the header,
      // which openResultsOverlay() hides for as long as this button is
      // even visible, so a language switch mid-flash isn't reachable
      // through today's UI — but re-deriving from the same source of
      // truth applyLanguage() uses costs nothing and stops this from
      // becoming a real bug the moment that constraint changes,
      // instead of silently reverting to a stale-language string.
      labelEl.textContent = t("results.share");
      resultsShareBtn.classList.remove("copied");
    }, 2000);
  }

  resultsShareBtn.addEventListener("click", shareResult);

  // ---- Speedometer gauge (needle dial) ----
  // A non-linear tick scale, same idea as a real speedometer: equal
  // ANGLE between ticks, unequal VALUE between them, so the low end
  // (where most real-world results land) gets most of the dial instead
  // of being crushed into a sliver next to a mostly-empty high end.
  // Piecewise-linear interpolation between whichever two ticks bracket
  // the live value maps that value to an angle — monotonic by
  // construction (each segment only moves the needle forward), so
  // there's no possibility of the backward "jump" a discrete auto-
  // scaling tier system had in an earlier version.
  const GAUGE_TICKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
  const GAUGE_START_DEG = -125; // needle angle at value 0 (down-left)
  const GAUGE_END_DEG = 125; // needle angle at the top tick (down-right)
  const SPEEDO_CENTER = { x: 110, y: 110 };
  const SPEEDO_RADIUS = 88;

  // Slow -> fast color ramp, one entry per GAUGE_TICKS index (same
  // non-linear value spacing, even angular spacing) — red at 0 Mbps
  // through orange/yellow/lime/green up to a cyan "blazing fast" at the
  // top of the dial, instead of one flat gray track. Drives both the
  // gradient track (see buildSpeedoSvg()) and the live needle/readout
  // tint (see valueToColor() below).
  const GAUGE_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#06b6d4", "#38bdf8"];

  // Shared by speedToAngle() and valueToColor() — both map a speed to a
  // 0..1 position along the tick scale, they just interpolate a
  // different thing (angle vs. color) at that position.
  function valueToFrac(mbpsValue) {
    const v = Math.max(0, Math.min(mbpsValue, GAUGE_TICKS[GAUGE_TICKS.length - 1]));
    let i = 0;
    while (i < GAUGE_TICKS.length - 2 && v > GAUGE_TICKS[i + 1]) i++;
    const segStart = GAUGE_TICKS[i];
    const segEnd = GAUGE_TICKS[i + 1];
    const segFrac = segEnd > segStart ? (v - segStart) / (segEnd - segStart) : 0;
    return (i + segFrac) / (GAUGE_TICKS.length - 1);
  }

  function speedToAngle(mbpsValue) {
    return GAUGE_START_DEG + valueToFrac(mbpsValue) * (GAUGE_END_DEG - GAUGE_START_DEG);
  }

  function lerpColor(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16);
    const b = parseInt(hexB.slice(1), 16);
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  function valueToColor(mbpsValue) {
    const idxFloat = valueToFrac(mbpsValue) * (GAUGE_COLORS.length - 1);
    const i0 = Math.floor(idxFloat);
    const i1 = Math.min(i0 + 1, GAUGE_COLORS.length - 1);
    return lerpColor(GAUGE_COLORS[i0], GAUGE_COLORS[i1], idxFloat - i0);
  }

  // angle 0 = straight up, positive = clockwise — matches how the
  // needle's rotate() transform is applied below.
  function polarPoint(angleDeg, radius) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: SPEEDO_CENTER.x + radius * Math.sin(rad),
      y: SPEEDO_CENTER.y - radius * Math.cos(rad),
    };
  }

  // SVG arc path between two angles (see polarPoint for the angle
  // convention) — shared by the static background track and the
  // colored progress arc that grows with the live reading.
  function describeArc(angleFrom, angleTo, radius) {
    const p1 = polarPoint(angleFrom, radius);
    const p2 = polarPoint(angleTo, radius);
    const largeArc = Math.abs(angleTo - angleFrom) > 180 ? 1 : 0;
    const sweep = angleTo >= angleFrom ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${p2.x} ${p2.y}`;
  }

  function buildSpeedoSvg() {
    const svg = document.getElementById("speedoSvg");
    const svgNS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs) => {
      const node = document.createElementNS(svgNS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      return node;
    };

    // Background track arc — dim, full range, always visible as the
    // "unfilled" backdrop the colored progress arc below draws over.
    svg.appendChild(
      el("path", { class: "speedo-track", d: describeArc(GAUGE_START_DEG, GAUGE_END_DEG, SPEEDO_RADIUS) })
    );

    // Track color gradient (defs), red -> cyan across GAUGE_COLORS —
    // referenced by the progress arc below. userSpaceOnUse + explicit
    // endpoints (not the default objectBoundingBox) for the same reason
    // as speedoNeedleGrad further down: a diagonal line across the
    // gauge's own coordinate space, independent of whatever partial arc
    // happens to be stroked with it.
    const trackStart = polarPoint(GAUGE_START_DEG, SPEEDO_RADIUS);
    const trackEnd = polarPoint(GAUGE_END_DEG, SPEEDO_RADIUS);
    const trackDefs = el("defs", {});
    const trackGrad = el("linearGradient", {
      id: "speedoTrackGrad",
      gradientUnits: "userSpaceOnUse",
      x1: trackStart.x,
      y1: trackStart.y,
      x2: trackEnd.x,
      y2: trackEnd.y,
    });
    GAUGE_COLORS.forEach((color, i) => {
      trackGrad.appendChild(el("stop", { offset: `${(i / (GAUGE_COLORS.length - 1)) * 100}%`, "stop-color": color }));
    });
    trackDefs.appendChild(trackGrad);
    svg.appendChild(trackDefs);

    // Progress arc — grows from GAUGE_START_DEG to the current reading's
    // angle (see updateGauge()/resetGauge()), starts as a zero-length
    // arc right at the start point. Colored by the gradient above, so
    // as it grows it reveals more of the red->cyan ramp rather than one
    // flat color — a glance at how much of the ramp is filled says
    // roughly as much as the number does.
    svg.appendChild(
      el("path", { id: "speedoProgress", class: "speedo-progress", d: describeArc(GAUGE_START_DEG, GAUGE_START_DEG, SPEEDO_RADIUS) })
    );

    // Minor ticks — purely decorative texture between the major
    // labeled ticks, evenly spaced by angle.
    const MINOR_PER_SEGMENT = 4;
    const totalMinor = (GAUGE_TICKS.length - 1) * MINOR_PER_SEGMENT;
    for (let m = 0; m <= totalMinor; m++) {
      if (m % MINOR_PER_SEGMENT === 0) continue; // skip where a major tick goes
      const angle = GAUGE_START_DEG + (m / totalMinor) * (GAUGE_END_DEG - GAUGE_START_DEG);
      const p1 = polarPoint(angle, SPEEDO_RADIUS + 11);
      const p2 = polarPoint(angle, SPEEDO_RADIUS + 15);
      svg.appendChild(el("line", { class: "speedo-tick-minor", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }));
    }

    // Major ticks + number labels.
    GAUGE_TICKS.forEach((tick, i) => {
      const angle = GAUGE_START_DEG + (i / (GAUGE_TICKS.length - 1)) * (GAUGE_END_DEG - GAUGE_START_DEG);
      const p1 = polarPoint(angle, SPEEDO_RADIUS + 9);
      const p2 = polarPoint(angle, SPEEDO_RADIUS + 17);
      svg.appendChild(el("line", { class: "speedo-tick-major", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }));
      const labelPos = polarPoint(angle, SPEEDO_RADIUS + 28);
      const label = el("text", { class: "speedo-tick-label", x: labelPos.x, y: labelPos.y });
      label.textContent = String(tick);
      svg.appendChild(label);
    });

    // Needle gradient (defined once, referenced by the needle's stroke).
    // gradientUnits="userSpaceOnUse" with explicit coordinates, not the
    // default objectBoundingBox — the needle <line> is perfectly
    // vertical before rotation (x1 === x2), so its bounding box has
    // ZERO width, which is degenerate for objectBoundingBox units; the
    // SVG spec says a paint server referencing a degenerate bounding
    // box is ignored entirely, silently making the needle invisible.
    const defs = el("defs", {});
    const grad = el("linearGradient", {
      id: "speedoNeedleGrad",
      gradientUnits: "userSpaceOnUse",
      x1: SPEEDO_CENTER.x,
      y1: SPEEDO_CENTER.y,
      x2: SPEEDO_CENTER.x,
      y2: SPEEDO_CENTER.y - SPEEDO_RADIUS + 14,
    });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "#5b6478" }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "#e8ecf5" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Needle — pivots around SPEEDO_CENTER via CSS transform (see
    // .speedo-needle's transform-box/transform-origin in style.css),
    // rotated per-frame in updateGauge()/resetGauge() below.
    const needle = el("line", {
      id: "speedoNeedle",
      class: "speedo-needle",
      x1: SPEEDO_CENTER.x,
      y1: SPEEDO_CENTER.y,
      x2: SPEEDO_CENTER.x,
      y2: SPEEDO_CENTER.y - SPEEDO_RADIUS + 14,
    });
    svg.appendChild(needle);
    svg.appendChild(el("circle", { class: "speedo-hub", cx: SPEEDO_CENTER.x, cy: SPEEDO_CENTER.y, r: 6 }));
  }
  buildSpeedoSvg();
  const speedoNeedleEl = document.getElementById("speedoNeedle");
  const speedoProgressEl = document.getElementById("speedoProgress");
  const speedoUnitIconEl = document.getElementById("speedoUnitIcon");
  const speedoUnitLabelEl = document.getElementById("speedoUnitLabel");

  function setSpeedoDirection(direction) {
    // direction: "down" (download) or "up" (upload) — swaps the little
    // arrow next to the unit label so the dial reads correctly for
    // whichever phase is currently running.
    speedoUnitIconEl.classList.toggle("icon-down", direction === "down");
    speedoUnitIconEl.classList.toggle("icon-up", direction === "up");
    speedoUnitIconEl.querySelector("path").setAttribute(
      "d",
      direction === "up" ? "M12 20V6M6 12l6-6 6 6" : "M12 4v14M6 12l6 6 6-6"
    );
  }

  function resetGauge() {
    speedoNeedleEl.style.transform = `rotate(${GAUGE_START_DEG}deg)`;
    speedoNeedleEl.style.filter = "none";
    speedoProgressEl.setAttribute("d", describeArc(GAUGE_START_DEG, GAUGE_START_DEG, SPEEDO_RADIUS));
    gaugeLiveValue.textContent = "0.00";
    gaugeLiveValue.style.color = "";
    gaugeLiveValue.style.textShadow = "none";
  }

  function updateGauge(mbpsValue) {
    const angle = speedToAngle(mbpsValue);
    const color = valueToColor(mbpsValue);
    speedoNeedleEl.style.transform = `rotate(${angle}deg)`;
    // Tints the needle to match the live reading (on top of its own
    // shine gradient, see speedoNeedleGrad) with a soft glow in the
    // same color — small touch, but it's what turns "gray dial" into
    // "this thing looks alive while a test is running".
    speedoNeedleEl.style.filter = `drop-shadow(0 0 5px ${color})`;
    speedoProgressEl.setAttribute("d", describeArc(GAUGE_START_DEG, angle, SPEEDO_RADIUS));
    gaugeLiveValue.textContent = mbpsValue.toFixed(2);
    gaugeLiveValue.style.color = color;
    gaugeLiveValue.style.textShadow = `0 0 16px ${color}`;
  }

  function mbps(bytes, seconds) {
    if (seconds <= 0) return 0;
    return (bytes * 8) / (seconds * 1_000_000);
  }

  // ---- Display unit (Mbps vs MB/s) — a pure display toggle, all
  // internal math and history/API values stay in Mbps regardless ----
  let currentUnit = "mbps"; // "mbps" | "MBps"
  let lastDownloadMbps = null;
  let lastUploadMbps = null;

  function formatSpeed(mbpsValue) {
    if (mbpsValue == null) return "—";
    return currentUnit === "MBps" ? (mbpsValue / 8).toFixed(2) : mbpsValue.toFixed(1);
  }

  function setDownloadDisplay(mbpsValue, live) {
    lastDownloadMbps = mbpsValue;
    rDown.textContent = formatSpeed(mbpsValue);
    if (live && mbpsValue != null) updateGauge(mbpsValue);
  }

  function setUploadDisplay(mbpsValue, live) {
    lastUploadMbps = mbpsValue;
    rUp.textContent = formatSpeed(mbpsValue);
    if (live && mbpsValue != null) updateGauge(mbpsValue);
  }

  unitToggle.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    currentUnit = e.target.dataset.unit;
    unitToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target));
    const unitLabel = currentUnit === "MBps" ? "MB/s" : "Mbps";
    rDownUnit.textContent = unitLabel;
    rUpUnit.textContent = unitLabel;
    rDown.textContent = formatSpeed(lastDownloadMbps);
    rUp.textContent = formatSpeed(lastUploadMbps);
  });

  // ---- Ping (sequential, before any load on the link) ----
  async function measurePing(onProgress) {
    const samples = [];
    for (let i = 0; i < PING_SAMPLES; i++) {
      const t0 = performance.now();
      await fetch("/api/speedtest/ping", { cache: "no-store" });
      samples.push(performance.now() - t0);
      // Real progress — one completed round trip out of PING_SAMPLES
      // total, not a time-based guess (ping's total duration isn't
      // known in advance, unlike the fixed-duration download/upload
      // phases below).
      if (onProgress) onProgress((i + 1) / PING_SAMPLES);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const jitter = samples.reduce((sum, s) => sum + Math.abs(s - avg), 0) / samples.length;
    return { ping_ms: median, jitter_ms: jitter };
  }

  /**
   * Runs `workerFn` on PARALLEL_CONNECTIONS lanes for TEST_DURATION_MS,
   * calling `onBytes(n)` from any lane whenever it moves n more bytes,
   * and `onTick()` roughly every UPDATE_INTERVAL_MS with the live
   * warmup-adjusted Mbps so far. Returns the final Mbps, computed only
   * from bytes moved after WARMUP_MS (see module docstring point 4).
   */
  async function runParallelTest(workerFn, onTick, onProgress) {
    let totalBytes = 0;
    let bytesAtWarmup = null;
    const t0 = performance.now();
    const controller = new AbortController();

    const tickTimer = setInterval(() => {
      const elapsedMs = performance.now() - t0;
      // Real progress — actual elapsed time against the fixed test
      // window, same clock the abort timer below uses to end the
      // phase, not a separate/fake estimate.
      if (onProgress) onProgress(elapsedMs / TEST_DURATION_MS);
      if (bytesAtWarmup === null && elapsedMs >= WARMUP_MS) {
        bytesAtWarmup = totalBytes;
      }
      if (bytesAtWarmup !== null) {
        const steadySec = (elapsedMs - WARMUP_MS) / 1000;
        onTick(mbps(totalBytes - bytesAtWarmup, steadySec));
      }
    }, UPDATE_INTERVAL_MS);

    const abortTimer = setTimeout(() => controller.abort(), TEST_DURATION_MS);

    const lanes = Array.from({ length: PARALLEL_CONNECTIONS }, () =>
      workerFn(controller.signal, (n) => {
        totalBytes += n;
      })
    );
    await Promise.allSettled(lanes);

    clearInterval(tickTimer);
    clearTimeout(abortTimer);
    // The interval above stops ticking once the lanes actually finish
    // settling, which can land a hair under 1 (e.g. a slightly-late
    // final tick, or lanes wrapping up right after one) — snap to
    // exactly full since the phase genuinely is done at this point.
    if (onProgress) onProgress(1);

    const totalElapsedMs = performance.now() - t0;
    if (bytesAtWarmup === null) {
      // Test ended before warmup elapsed (very slow link, or aborted
      // early) — fall back to the whole window rather than reporting 0.
      return mbps(totalBytes, totalElapsedMs / 1000);
    }
    const steadySec = (totalElapsedMs - WARMUP_MS) / 1000;
    return mbps(totalBytes - bytesAtWarmup, steadySec);
  }

  // ---- Download: N parallel streams, each requesting far more than
  // could be consumed in TEST_DURATION_MS, aborted when time's up ----
  async function downloadLane(signal, onBytes) {
    try {
      const res = await fetch("/api/speedtest/download", { signal, cache: "no-store" });
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onBytes(value.length);
      }
    } catch (e) {
      // aborted when the test window ended — expected, not an error
    }
  }

  function measureDownload() {
    return runParallelTest(downloadLane, (v) => setDownloadDisplay(v, true), setTestProgress);
  }

  // ---- Upload: N parallel lanes, each looping fixed-size chunk POSTs
  // (not one giant body — keeps browser memory bounded) until aborted.
  //
  // Uses XMLHttpRequest, not fetch — deliberately. An earlier version
  // used fetch() and counted a chunk as "sent" only once the whole POST
  // resolved. That's fine on a fast link, but on a slow one (say a few
  // Mbps upload — common, not an edge case) a single 4 MB chunk can take
  // longer than the entire test window to finish, so onBytes() never
  // fires even once and the result comes back as a flat 0 Mbps — this
  // is the real bug a report of "upload shows 0" turned out to be.
  // XHR's upload.onprogress fires incrementally as bytes actually go
  // out over the wire, the same way the download side already tracks
  // partial progress via its stream reader, so throughput is measured
  // correctly regardless of whether any single chunk ever completes
  // before the window ends. ----
  const UPLOAD_CHUNK_BYTES = 4_000_000;
  const _uploadBuffer = new Uint8Array(UPLOAD_CHUNK_BYTES);

  function xhrUploadOnce(signal, onBytes) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const xhr = new XMLHttpRequest();
      let lastLoaded = 0;
      xhr.open("POST", "/api/speedtest/upload");
      xhr.upload.onprogress = (e) => {
        onBytes(e.loaded - lastLoaded);
        lastLoaded = e.loaded;
      };
      // Removed once this settles either way — signal is the SAME
      // AbortController's signal reused across every chunk in the
      // lane's whole retry loop below, not a fresh one per request, so
      // leaving a still-attached {once:true} listener behind on every
      // successful chunk (it only auto-removes if it actually fires)
      // would otherwise pile up one dead listener per chunk for the
      // entire 8s window.
      const onSignalAbort = () => xhr.abort();
      const cleanup = () => signal.removeEventListener("abort", onSignalAbort);
      xhr.onload = () => {
        cleanup();
        // xhr.onload fires for ANY completed response, 429/500 included
        // — without this check, a rate-limited or server-error response
        // silently counted as success (resolve()), so the retry/backoff
        // logic in uploadLane() never kicked in for it. Real-world
        // impact: any connection fast enough to burst past the upload
        // rate limit within one test window got a response that LOOKED
        // successful per-request but carried ~0 real bytes each time
        // (the server rejects before accepting the body), so the lane
        // just spun through hundreds of instant "successful" no-op
        // requests all the way to the actual result: 0 or near-0 Mbps.
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`upload failed with status ${xhr.status}`));
        }
      };
      xhr.onerror = () => { cleanup(); reject(new Error("upload network error")); };
      xhr.onabort = () => { cleanup(); reject(new DOMException("aborted", "AbortError")); };
      signal.addEventListener("abort", onSignalAbort);
      xhr.send(_uploadBuffer);
    });
  }

  async function uploadLane(signal, onBytes) {
    while (!signal.aborted) {
      try {
        await xhrUploadOnce(signal, onBytes);
      } catch (e) {
        // Previously this try/catch wrapped the whole while loop, so
        // ANY single failed chunk — including one genuinely transient
        // hiccup, not just the expected end-of-window abort — silently
        // ended this entire lane for the rest of the test, contributing
        // zero more bytes for however many seconds were left. Reported
        // as the upload result coming back ~0 (or the test "hanging",
        // since the outer 8s timer runs regardless of whether any lane
        // is still doing anything) alongside a net::ERR_HTTP2_PROTOCOL_
        // ERROR in the console — that's a real, if transient, network/
        // protocol failure, but one bad chunk shouldn't take the whole
        // lane down with it.
        if (signal.aborted) break; // the expected, deliberate end-of-window case
        // A genuine failure — pause briefly before retrying so a flaky
        // connection/transient server-side hiccup gets a moment to
        // clear instead of being hammered with an immediate retry (same
        // idea as the continuous-ping loop's own pause between rounds).
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  function measureUpload() {
    return runParallelTest(uploadLane, (v) => setUploadDisplay(v, true), setTestProgress);
  }

  async function saveResult(result) {
    try {
      await fetch("/api/speedtest/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
    } catch (e) {
      // best-effort — losing one history row isn't worth surfacing an error
    }
  }

  async function runTest() {
    // The continuous-ping tab hits these same /ping, /download, /upload
    // endpoints in its own loop (see runPingLoop() below) — if it were
    // left running during the main test, both would compete for the
    // same bandwidth/connections and silently corrupt each other's
    // numbers instead of erroring, which is worse. stopPingLoop() is a
    // no-op if it isn't running.
    stopPingLoop();
    speedoWrapEl.hidden = false; // reveal the dial now that a test is actually running
    ispInfoEl.hidden = false; // same — ISP/location join the button once a test starts, not before
    locationInfoEl.hidden = false;
    runBtn.hidden = true; // hide the moment the test starts, not just once it finishes
    runBtn.disabled = true;
    rPing.textContent = "—";
    rJitter.textContent = "—";
    setDownloadDisplay(null);
    setUploadDisplay(null);
    resultMetaEl.textContent = "";
    resetGauge();
    testProgressTrackEl.hidden = false;
    setTestProgress(0);

    try {
      testPhaseEl.textContent = t("testing.ping");
      const { ping_ms, jitter_ms } = await measurePing(setTestProgress);
      rPing.textContent = ping_ms.toFixed(0);
      rJitter.textContent = jitter_ms.toFixed(1);

      setSpeedoDirection("down");
      testPhaseEl.textContent = t("testing.download");
      setTestProgress(0); // fresh bar per phase, same reasoning as resetGauge() below
      const download_mbps = await measureDownload();
      setDownloadDisplay(download_mbps);

      resetGauge(); // fresh scale for upload — often a very different range than download
      setSpeedoDirection("up");
      testPhaseEl.textContent = t("testing.upload");
      setTestProgress(0);
      const upload_mbps = await measureUpload();
      setUploadDisplay(upload_mbps);

      testPhaseEl.textContent = "";
      testProgressTrackEl.hidden = true;
      resultMetaEl.textContent = t("result.done", { date: new Date().toLocaleString(localeName()) });

      const result = { ping_ms, jitter_ms, download_mbps, upload_mbps };
      await saveResult(result);
      loadHistory(document.querySelector('.range-toggle[data-target="history"] button.active').dataset.range);
      // The results overlay (with its own, smaller start-another-test
      // button) takes over from here — hide the main one so it's not
      // sitting there redundantly once you close back to the main page.
      runBtn.hidden = true;
      showResultsOverlay(result);
    } catch (e) {
      testPhaseEl.textContent = "";
      testProgressTrackEl.hidden = true;
      resultMetaEl.textContent = t("result.error");
      resetGauge();
      // No results overlay (with its own restart button) shows on
      // error — bring the main button back or there'd be no way to
      // retry at all.
      runBtn.hidden = false;
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener("click", runTest);

  // ---- History charts (two separate bar charts, download and upload
  // stacked one above the other, per user request) ----
  // Each bar is one saved test result, labeled by the time it ran — a
  // CATEGORY x-axis (one discrete label per test), not a continuous
  // time scale, since the point is comparing individual runs against
  // each other, not tracing a continuous quantity over time.
  // Chart.js bakes color strings into its config at creation time — it
  // doesn't read CSS custom properties live — so tick/grid colors are
  // pulled from the current theme's computed CSS vars here, and
  // re-applied by refreshChartTheme() whenever the theme toggles (see
  // #themeToggle above), or the light-mode grid/labels would stay
  // stuck with dark-mode colors after a switch.
  function themeVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Ping is plotted as a line overlaid on the download/upload bars, on
  // its own right-hand axis (ms, not Mbps) — lets you spot at a glance
  // whether a slow result lined up with a ping spike, without needing
  // a separate chart to cross-reference against. Amber (--amber) is
  // used nowhere else in these two charts (blue/green already taken by
  // download/upload), so the two data types stay visually separable.
  function makeHistoryBarChart(canvasId, color) {
    return new Chart(document.getElementById(canvasId).getContext("2d"), {
      data: {
        labels: [],
        datasets: [
          {
            type: "bar",
            data: [],
            backgroundColor: color,
            borderRadius: 4,
            maxBarThickness: 48,
            order: 2,
          },
          {
            type: "line",
            data: [],
            borderColor: themeVar("--amber"),
            backgroundColor: themeVar("--amber"),
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.3,
            yAxisID: "yPing",
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        // "index"+intersect:false — hovering anywhere along a given
        // x position shows both the bar and the ping point together,
        // rather than needing to land the cursor exactly on one or the
        // other.
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { color: themeVar("--text-dim") }, grid: { display: false } },
          y: {
            ticks: { color: themeVar("--text-dim") },
            grid: { color: themeVar("--border") },
            beginAtZero: true,
            title: { display: true, text: "Mbps", color: themeVar("--text-dim") },
          },
          yPing: {
            position: "right",
            ticks: { color: themeVar("--amber") },
            grid: { display: false }, // one grid (the Mbps axis') is enough
            beginAtZero: true,
            title: { display: true, text: "ms", color: themeVar("--amber") },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              // Exact value + unit, spelled out per line, instead of
              // Chart.js's bare-number default.
              label: (ctx) => {
                if (ctx.parsed.y == null) return undefined;
                const unit = ctx.dataset.yAxisID === "yPing" ? "ms" : "Mbps";
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ${unit}`;
              },
            },
          },
        },
      },
    });
  }

  const historyChartDown = makeHistoryBarChart("historyChartDown", "#4f8cff");
  const historyChartUp = makeHistoryBarChart("historyChartUp", "#33c07c");
  const historyEmptyEl = document.getElementById("historyEmpty");
  const historyChartDownBlockEl = document.getElementById("historyChartDownBlock");
  const historyChartUpBlockEl = document.getElementById("historyChartUpBlock");
  const historyChartDownPingToggle = document.getElementById("historyChartDownPingToggle");
  const historyChartUpPingToggle = document.getElementById("historyChartUpPingToggle");

  function applyHistoryPingToggle(chart, toggleEl) {
    chart.setDatasetVisibility(1, toggleEl.checked);
    chart.update();
  }
  historyChartDownPingToggle.addEventListener("change", () =>
    applyHistoryPingToggle(historyChartDown, historyChartDownPingToggle)
  );
  historyChartUpPingToggle.addEventListener("change", () =>
    applyHistoryPingToggle(historyChartUp, historyChartUpPingToggle)
  );

  // ---- Continuous-ping trend chart ----
  // Built once when a continuous-ping run is stopped (not live-updated
  // mid-run — see the toggle handler below), from the same
  // pingLoopDownSamples/pingLoopUpSamples arrays the summary tiles
  // average. A connected line (not bars, unlike the history charts
  // above) since the point here is the trend across one continuous
  // run, round to round, not comparing separate discrete tests.
  const pingLoopChart = new Chart(document.getElementById("pingLoopChart").getContext("2d"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: t("ping.chartDown"),
          data: [],
          borderColor: "#4f8cff",
          backgroundColor: "#4f8cff",
          pointRadius: 2,
          tension: 0.3,
        },
        {
          label: t("ping.chartUp"),
          data: [],
          borderColor: "#33c07c",
          backgroundColor: "#33c07c",
          pointRadius: 2,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { ticks: { color: themeVar("--text-dim") }, grid: { display: false } },
        y: {
          ticks: { color: themeVar("--text-dim") },
          grid: { color: themeVar("--border") },
          beginAtZero: true,
          title: { display: true, text: "Mbps", color: themeVar("--text-dim") },
        },
      },
      // Legend off — the checkboxes above the chart (#pingChartToggleDown/Up)
      // do the same show/hide job as an obvious, always-visible control,
      // instead of the chart's own legend where "click to toggle" isn't
      // obvious at a glance.
      plugins: { legend: { display: false } },
    },
  });

  const pingChartToggleDownEl = document.getElementById("pingChartToggleDown");
  const pingChartToggleUpEl = document.getElementById("pingChartToggleUp");
  function applyPingChartSeriesToggles() {
    pingLoopChart.setDatasetVisibility(0, pingChartToggleDownEl.checked);
    pingLoopChart.setDatasetVisibility(1, pingChartToggleUpEl.checked);
    pingLoopChart.update();
  }
  pingChartToggleDownEl.addEventListener("change", applyPingChartSeriesToggles);
  pingChartToggleUpEl.addEventListener("change", applyPingChartSeriesToggles);

  function refreshChartTheme() {
    [historyChartDown, historyChartUp].forEach((chart) => {
      chart.options.scales.x.ticks.color = themeVar("--text-dim");
      chart.options.scales.y.ticks.color = themeVar("--text-dim");
      chart.options.scales.y.grid.color = themeVar("--border");
      chart.options.scales.y.title.color = themeVar("--text-dim");
      // --amber itself changes between the light/dark palettes (see
      // :root vs the light-mode override in style.css), not just
      // --text-dim/--border — the ping line/axis needs the same
      // re-read-on-toggle treatment as everything else here.
      const amber = themeVar("--amber");
      chart.options.scales.yPing.ticks.color = amber;
      chart.options.scales.yPing.title.color = amber;
      chart.data.datasets[1].borderColor = amber;
      chart.data.datasets[1].backgroundColor = amber;
      chart.update();
    });
    pingLoopChart.options.scales.x.ticks.color = themeVar("--text-dim");
    pingLoopChart.options.scales.y.ticks.color = themeVar("--text-dim");
    pingLoopChart.options.scales.y.grid.color = themeVar("--border");
    pingLoopChart.options.scales.y.title.color = themeVar("--text-dim");
    pingLoopChart.update();
  }

  // Rebuilds the trend chart from this run's collected samples — called
  // once the loop is stopped (see the toggle handler below), not on
  // every round, per the "build it when the test finishes" request.
  function renderPingLoopChart() {
    if (pingLoopDownSamples.length === 0) {
      pingLoopChartBlockEl.hidden = true;
      return;
    }
    const roundLabel = t("ping.chartRound");
    pingLoopChart.data.labels = pingLoopDownSamples.map((_, i) => `${roundLabel} ${i + 1}`);
    pingLoopChart.data.datasets[0].label = t("ping.chartDown");
    pingLoopChart.data.datasets[0].data = pingLoopDownSamples;
    pingLoopChart.data.datasets[1].label = t("ping.chartUp");
    pingLoopChart.data.datasets[1].data = pingLoopUpSamples;
    applyPingChartSeriesToggles(); // re-assert the checkboxes' state, calls update()
    pingLoopChartBlockEl.hidden = false;
  }

  // Label format depends on range: a single day of tests only needs the
  // time; a week needs the date too, or same-time tests on different
  // days would look identical on the x-axis.
  function formatHistoryLabel(ts, range) {
    const d = new Date(ts);
    return range === "week"
      ? d.toLocaleString(localeName(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString(localeName(), { hour: "2-digit", minute: "2-digit" });
  }

  async function loadHistory(range) {
    const res = await fetch(`/api/speedtest/history?range=${range}`);
    const data = await res.json();

    // A brand-new visitor (or a fresh range with nothing in it yet) got
    // two bare, empty 0-to-1.0 chart grids here before — same "show a
    // real empty-state message instead of a blank chart" treatment the
    // continuous-ping tab already had (see #pingLogEmpty).
    const isEmpty = data.results.length === 0;
    historyEmptyEl.hidden = !isEmpty;
    historyChartDownBlockEl.hidden = isEmpty;
    historyChartUpBlockEl.hidden = isEmpty;
    if (isEmpty) return;

    const downRows = data.results.filter((r) => r.download_mbps != null);
    const upRows = data.results.filter((r) => r.upload_mbps != null);

    // Dataset labels drive the tooltip text (see makeHistoryBarChart's
    // tooltip.callbacks.label) — reassigned on every load, not just
    // once at chart creation, so they stay correct across a language
    // switch (applyLanguage() re-calls loadHistory()).
    historyChartDown.data.labels = downRows.map((r) => formatHistoryLabel(r.timestamp, range));
    historyChartDown.data.datasets[0].label = t("stat.download");
    historyChartDown.data.datasets[0].data = downRows.map((r) => r.download_mbps);
    historyChartDown.data.datasets[1].label = t("mini.ping");
    historyChartDown.data.datasets[1].data = downRows.map((r) => r.ping_ms);
    historyChartDown.update();

    historyChartUp.data.labels = upRows.map((r) => formatHistoryLabel(r.timestamp, range));
    historyChartUp.data.datasets[0].label = t("stat.upload");
    historyChartUp.data.datasets[0].data = upRows.map((r) => r.upload_mbps);
    historyChartUp.data.datasets[1].label = t("mini.ping");
    historyChartUp.data.datasets[1].data = upRows.map((r) => r.ping_ms);
    historyChartUp.update();
  }

  document.querySelectorAll(".range-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      toggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target));
      loadHistory(e.target.dataset.range);
    });
  });

  resetGauge();

  // ---- Tab nav ----
  function switchTab(tabName) {
    document.querySelectorAll(".tab-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
    document.querySelectorAll(".page-tab").forEach((tab) => {
      tab.hidden = tab.id !== `tab-${tabName}`;
    });
  }
  document.querySelectorAll(".tab-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  // Footer shortcuts to each tab — same switch, just a second entry
  // point.
  document.querySelectorAll("[data-tab-link]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(link.dataset.tabLink);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // ---- Continuous ping + mini download/upload (like `ping -t`, plus a
  // lightweight speed reading every round) ----
  // Each round measures three things: ping (round trip to an endpoint
  // that does nothing but reply instantly), a small download probe, and
  // a small upload probe — single-request timing, not the parallel
  // duration-based methodology the main speed test uses, since the
  // point here is a quick per-round reading repeated many times, not
  // one maximally-accurate number. Probe sizes are deliberately small
  // (500 KB down / 250 KB up) so a round stays quick even on a slow
  // link and repeating this continuously doesn't add real bandwidth
  // load — still nowhere near the main test's hundreds of MB.
  const PING_LOOP_DOWNLOAD_BYTES = 500_000;
  const PING_LOOP_UPLOAD_BYTES = 250_000;
  const pingLoopUploadBuffer = new Uint8Array(PING_LOOP_UPLOAD_BYTES);

  const pingLoopToggleBtn = document.getElementById("pingLoopToggleBtn");
  const pingLoopBtnLabelEl = document.getElementById("pingLoopBtnLabel");
  const pingLoopChartBlockEl = document.getElementById("pingLoopChartBlock");
  const pingLogEl = document.getElementById("pingLog");
  const pingLogEmptyEl = document.getElementById("pingLogEmpty");
  const pingSummaryRowEl = document.getElementById("pingSummaryRow");
  const pingSummaryRoundsEl = document.getElementById("pingSummaryRounds");
  const pingSummaryPingEl = document.getElementById("pingSummaryPing");
  const pingSummaryDownEl = document.getElementById("pingSummaryDown");
  const pingSummaryUpEl = document.getElementById("pingSummaryUp");
  let pingLoopRunning = false;
  let pingLoopPingSamples = [];
  let pingLoopDownSamples = [];
  let pingLoopUpSamples = [];
  let pingLoopSeq = 0;

  // Traffic-light thresholds — ping in ms (lower is better), down/up in
  // Mbps (higher is better). Same "good/warn/bad" 3-tier read as a real
  // ping tool's colored latency, extended here to the two speed probes
  // too. The Mbps cutoffs are a rough general-purpose heuristic (fine
  // for browsing/streaming at the low end, clearly fast above it), not
  // measured against any particular use case.
  function pingQualityClass(ms) {
    if (ms < 100) return "ping-good";
    if (ms <= 400) return "ping-warn";
    return "ping-bad";
  }
  function speedQualityClass(mbpsValue) {
    if (mbpsValue >= 25) return "ping-good";
    if (mbpsValue >= 5) return "ping-warn";
    return "ping-bad";
  }

  function pingBadge(text, cls) {
    const span = document.createElement("span");
    span.className = "ping-badge " + cls;
    span.textContent = text;
    return span;
  }

  function appendPingLogLine(pingMs, downMbps, upMbps, isError) {
    pingLogEmptyEl.hidden = true;
    pingLogEl.hidden = false;

    const row = document.createElement("div");
    row.className = "ping-row" + (isError ? " error" : "");
    if (isError) {
      const seq = document.createElement("span");
      seq.className = "ping-row-seq";
      seq.textContent = `#${pingLoopSeq}`;
      const err = document.createElement("span");
      err.className = "ping-row-error";
      err.textContent = t("ping.error");
      row.append(seq, err);
    } else {
      const seq = document.createElement("span");
      seq.className = "ping-row-seq";
      seq.textContent = `#${pingLoopSeq}`;

      // Grouped into two explicit lines (ping alone, download+upload
      // together) instead of one flex row left to wrap on its own —
      // four items don't fit one line on a narrow phone, and letting
      // the wrap fall wherever it happened to (usually stranding the
      // upload badge alone, mis-aligned under nothing) looked broken.
      // This way the break point is always the same, deliberate one.
      const speeds = document.createElement("span");
      speeds.className = "ping-row-speeds";
      speeds.append(
        pingBadge(`↓ ${downMbps.toFixed(1)} Mbps`, speedQualityClass(downMbps)),
        pingBadge(`↑ ${upMbps.toFixed(1)} Mbps`, speedQualityClass(upMbps))
      );

      row.append(seq, pingBadge(`${t("ping.pingLabel")} ${pingMs.toFixed(0)}ms`, pingQualityClass(pingMs)), speeds);
    }
    pingLogEl.appendChild(row);
    pingLogEl.scrollTop = pingLogEl.scrollHeight;
  }

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function renderPingStats() {
    if (pingLoopPingSamples.length === 0) return;
    pingSummaryRowEl.hidden = false;
    pingSummaryRoundsEl.textContent =
      currentLang === "fa" ? String(pingLoopSeq).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]) : String(pingLoopSeq);
    pingSummaryPingEl.textContent = `${avg(pingLoopPingSamples).toFixed(0)}ms`;
    pingSummaryDownEl.textContent = `${avg(pingLoopDownSamples).toFixed(1)} Mbps`;
    pingSummaryUpEl.textContent = `${avg(pingLoopUpSamples).toFixed(1)} Mbps`;
  }

  async function measurePingLoopDownload() {
    const t0 = performance.now();
    const res = await fetch(`/api/speedtest/download?bytes=${PING_LOOP_DOWNLOAD_BYTES}`, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    return mbps(buf.byteLength, (performance.now() - t0) / 1000);
  }

  function measurePingLoopUpload() {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/speedtest/upload");
      xhr.onload = () => resolve(mbps(PING_LOOP_UPLOAD_BYTES, (performance.now() - t0) / 1000));
      xhr.onerror = () => reject(new Error("upload failed"));
      xhr.send(pingLoopUploadBuffer);
    });
  }

  async function pingLoopStep() {
    pingLoopSeq++;
    try {
      const t0 = performance.now();
      const pingRes = await fetch("/api/speedtest/ping", { cache: "no-store" });
      const pingMs = performance.now() - t0;
      if (!pingRes.ok) throw new Error(`HTTP ${pingRes.status}`);

      const [downMbps, upMbps] = await Promise.all([measurePingLoopDownload(), measurePingLoopUpload()]);

      pingLoopPingSamples.push(pingMs);
      pingLoopDownSamples.push(downMbps);
      pingLoopUpSamples.push(upMbps);
      appendPingLogLine(pingMs, downMbps, upMbps, false);
    } catch (e) {
      appendPingLogLine(null, null, null, true);
    }
    renderPingStats();
  }

  async function runPingLoop() {
    while (pingLoopRunning) {
      await pingLoopStep();
      // A short pause between rounds — each round already takes real
      // time (the download/upload probes), this just avoids back-to-
      // back rounds with zero breathing room between them.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Shared by the toggle button's click handler and runTest() (see
  // above) — stopping the loop mid-round just lets its current
  // pingLoopStep() finish and the while-loop in runPingLoop() exit
  // rather than aborting anything in-flight, same as a manual stop.
  function stopPingLoop() {
    if (!pingLoopRunning) return;
    pingLoopRunning = false;
    pingLoopBtnLabelEl.textContent = t("pingtab.start");
    pingLoopToggleBtn.classList.remove("running");
    renderPingLoopChart();
  }

  pingLoopToggleBtn.addEventListener("click", () => {
    if (pingLoopRunning) {
      stopPingLoop();
      return;
    }
    pingLoopRunning = true;
    pingLoopPingSamples = [];
    pingLoopDownSamples = [];
    pingLoopUpSamples = [];
    pingLoopSeq = 0;
    pingLogEl.textContent = "";
    pingLogEl.hidden = true;
    pingLogEmptyEl.hidden = false;
    pingSummaryRowEl.hidden = true;
    pingLoopChartBlockEl.hidden = true;
    pingLoopBtnLabelEl.textContent = t("pingtab.stop");
    pingLoopToggleBtn.classList.add("running");
    runPingLoop();
  });

  // Apply the stored/default language now that every section above
  // (ping loop, history charts, etc.) it touches is initialized —
  // applyLanguage() itself reloads the history charts with correctly-
  // localized labels. Deliberately does NOT load and display the last
  // saved result on this reload (an earlier version did, via a now-
  // removed loadLatest()) — every page load should start from a blank
  // slate, not show a previous test's numbers before the visitor has
  // run one themselves.
  applyLanguage(getStoredLang() === "en" ? "en" : "fa");
})();

// ---- PWA: service worker registration ----
// Outside the IIFE above — doesn't touch anything in its scope, and a
// registration failure (unsupported browser, plain-HTTP dev without
// localhost, etc.) shouldn't be able to affect app startup either way.
// sw.js itself never intercepts /api/* (see its own comment) — this
// only ever affects the static shell (HTML/CSS/JS/fonts/icons), never
// a speed-test measurement.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Best-effort — no install prompt / offline shell if this fails,
      // but the app itself works exactly the same either way.
    });
  });
}
