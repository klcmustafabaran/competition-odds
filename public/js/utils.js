// Birden fazla dosyanın kullandığı küçük yardımcılar.
(function () {
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const pct = (p) => `%${Math.round(p * 100)}`;

  function logo(team, size) {
    if (team.logo) return `<img class="logo ${size}" src="${esc(team.logo)}" alt="" loading="lazy">`;
    const initials = team.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toLocaleUpperCase('tr');
    return `<span class="logo ${size} placeholder">${esc(initials)}</span>`;
  }

  window.CO = window.CO || {};
  window.CO.util = { esc, pct, logo };
})();
