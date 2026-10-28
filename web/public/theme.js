(function () {
  var choice = 'system';
  try {
    choice = localStorage.getItem('kl-theme') || 'system';
  } catch (e) {}
  var dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
