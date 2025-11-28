document.addEventListener("DOMContentLoaded", () => {
  const learnMoreBtn = document.getElementById("learnMoreBtn");
  const learnLink = document.getElementById("learnLink");
  const perfSection = document.getElementById("performance");

  // scroll to performance when hero button or nav link clicked
  function scrollToPerformance() {
    if (!perfSection) return;
    perfSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (learnMoreBtn) learnMoreBtn.addEventListener("click", scrollToPerformance);
  if (learnLink) learnLink.addEventListener("click", (e) => { e.preventDefault(); scrollToPerformance(); });

  // If performance section exists, render static visuals (no animations)
  if (perfSection) {
    // Donut: static fill based on data-value attribute (0..100)
    const donutSvg = perfSection.querySelector('.donut');
    const donutFill = perfSection.querySelector('.donut-fill');
    const donutText = perfSection.querySelector('.donut-text');
    if (donutSvg && donutFill && donutText) {
      const donutValue = Number(donutSvg.getAttribute('data-value') || 92);
      const p = Math.max(0, Math.min(100, donutValue));
      donutFill.style.strokeDasharray = `${p} ${100 - p}`;
      donutText.textContent = `${Math.round(p)}%`;
    }

    // Meter: static width is already set inline in HTML, ensure numeric label matches data-value
    const meterFill = perfSection.querySelector('.meter-fill');
    const meterValueEl = perfSection.querySelector('.meter-value');
    if (meterFill && meterValueEl) {
      const sec = Number(meterFill.getAttribute('data-value') || parseFloat(meterValueEl.textContent) || 1.2);
      // Update numeric label
      meterValueEl.textContent = sec.toFixed(1);
      // If no inline width was set, compute reasonable width using a fixed maxExpected (2.5s)
      if (!meterFill.style.width) {
        const maxExpected = 2.5;
        const percent = Math.min(100, (sec / maxExpected) * 100);
        meterFill.style.width = `${percent}%`;
      }
    }

    // Counter: static value from data-target (display it immediately)
    const counterEl = perfSection.querySelector('.count');
    if (counterEl) {
      const target = Number(counterEl.getAttribute('data-target') || 500);
      counterEl.textContent = target.toLocaleString();
    }
  }
  // Render static donut and meter immediately (no animation)
(function renderStaticMetrics() {
  const perfSection = document.getElementById('performance');
  if (!perfSection) return;

  // donut
  const donutSvg = perfSection.querySelector('.donut');
  const donutFill = perfSection.querySelector('.donut-fill');
  const donutText = perfSection.querySelector('.donut-text');
  if (donutSvg && donutFill && donutText) {
    const v = Number(donutSvg.getAttribute('data-value') || 92);
    const p = Math.max(0, Math.min(100, v));
    donutFill.style.strokeDasharray = `${p} ${100 - p}`;
    donutText.textContent = `${Math.round(p)}%`;
  }

  // meter numeric label sync (if meter-fill has data-value)
  const meterFill = perfSection.querySelector('.meter-fill');
  const meterValueEl = perfSection.querySelector('.meter-value');
  if (meterFill && meterValueEl) {
    const sec = Number(meterFill.getAttribute('data-value') || parseFloat(meterValueEl.textContent) || 1.2);
    meterValueEl.textContent = sec.toFixed(1);
    // if inline width not set, compute percent with 2.5s max
    if (!meterFill.style.width) {
      const percent = Math.min(100, (sec / 2.5) * 100);
      meterFill.style.width = `${percent}%`;
    }
  }

  // counter static
  const counterEl = perfSection.querySelector('.count');
  if (counterEl) {
    const t = Number(counterEl.getAttribute('data-target') || 500);
    counterEl.textContent = t.toLocaleString();
  }
})();

});
