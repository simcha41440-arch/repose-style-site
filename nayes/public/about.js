document.getElementById("year").textContent = new Date().getFullYear();

const form = document.getElementById("contact-form");
const params = new URLSearchParams(location.search);
if (params.get("topic")) form.topic.value = params.get("topic");
if (location.hash === "#contact") form.name.focus();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("form-msg");
  const btn = form.querySelector("button");
  const data = Object.fromEntries(new FormData(form));
  if (!data.phone && !data.email) {
    msg.style.color = "#c0392b";
    msg.textContent = "נא להשאיר טלפון או מייל, כדי שנוכל לחזור אליכם.";
    return;
  }
  btn.disabled = true;
  msg.style.color = "var(--muted)";
  msg.textContent = "שולח...";
  try {
    const r = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || "השליחה נכשלה");
    form.reset();
    msg.style.color = "#12a150";
    msg.textContent = "הפנייה נשלחה. תודה! נחזור אליכם בהקדם.";
  } catch (err) {
    msg.style.color = "#c0392b";
    msg.textContent = err.message;
  }
  btn.disabled = false;
});
