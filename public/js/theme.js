// Açık / koyu tema düğmesi. Seçim yapılmadıysa bilgisayarın ayarı kullanılır.
(function () {
  const root = document.documentElement;
  const button = document.querySelector('#theme-toggle');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const currentTheme = () => root.dataset.theme || (systemDark.matches ? 'dark' : 'light');

  // Düğme, geçilecek temayı gösterir.
  function updateButton() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    button.querySelector('.theme-icon').textContent = next === 'dark' ? '🌙' : '☀️';
    button.querySelector('.theme-label').textContent = next === 'dark' ? 'Koyu tema' : 'Açık tema';
    button.setAttribute('aria-label', next === 'dark' ? 'Koyu temaya geç' : 'Açık temaya geç');
  }

  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('co-theme', next);
    } catch {
      // Kaydedilemezse tema sadece bu oturumda geçerli olur.
    }
    updateButton();
  });

  systemDark.addEventListener('change', updateButton);
  updateButton();
})();
