/* MOLE tracking snippet for business websites. Paste before </body> on every page:
   <script src="https://merchcorphub.github.io/Mole/business/mole-pixel.js"
           data-key="YOUR-BUSINESS-PUBLIC-KEY"
           data-endpoint="https://YOUR-PROJECT-REF.supabase.co/functions/v1/conversion"></script>
   Then on your thank-you / order-confirmation page:
   <script>MOLE.convert({ orderRef: "1001", amountCents: 4999, email: "customer@example.com" });</script>
   For leads or sign-ups, call MOLE.convert({ orderRef: "lead-123", email: "..." }) after the form submits. */
(function () {
  var s = document.currentScript, key = s && s.getAttribute("data-key"), endpoint = s && s.getAttribute("data-endpoint");
  var p = new URLSearchParams(location.search), click = p.get("mole_click");
  try {
    if (click) localStorage.setItem("mole_click", JSON.stringify({ id: click, t: Date.now() })); // last click wins
  } catch (e) {}
  function stored() {
    try { var v = JSON.parse(localStorage.getItem("mole_click") || "null"); return v && Date.now() - v.t < 30 * 864e5 ? v.id : null; } catch (e) { return null; }
  }
  window.MOLE = {
    convert: function (o) {
      o = o || {};
      var c = stored();
      if (!c && !o.promoCode) return Promise.resolve({ skipped: "no MOLE referral" });
      return fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "x-mole-key": key },
        body: JSON.stringify({ click_id: c, promo_code: o.promoCode || null, order_ref: o.orderRef || null, amount_cents: o.amountCents || null, customer_email: o.email || null, customer_label: o.label || null }),
      }).then(function (r) { if (r.ok) try { localStorage.removeItem("mole_click"); } catch (e) {} return r.json(); });
    },
  };
})();
