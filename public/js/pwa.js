// Telefonda "ana ekrana ekle" desteği: servis çalışanını kaydeder ve kurulum düğmesini gösterir.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Servis çalışanı kaydedilemedi:', err.message));
    });
  }

  const button = document.querySelector('#install-app');
  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    button.hidden = false;
  });

  button?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    button.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.hidden = true;
  });
})();
