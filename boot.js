/* Nearcast boot and service worker registration. */

// Register service worker for PWA / offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
    navigator.serviceWorker.register(new URL("sw.js", window.location.href).pathname)
      .then(registration => registration.update().catch(() => {}))
      .catch(() => {});
  });
}

// Start the app last, after every module-level declaration is initialized,
// so the synchronous startup path can't hit a temporal-dead-zone reference.
init();
