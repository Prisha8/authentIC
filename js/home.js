document.addEventListener("DOMContentLoaded", () => {
  const learnMoreBtn = document.getElementById("learnMoreBtn");

  learnMoreBtn.addEventListener("click", () => {
    document.querySelector("#about").scrollIntoView({ behavior: "smooth" });
  });
});
