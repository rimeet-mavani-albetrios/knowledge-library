(function () {
  var choice = 'system';
  try {
    choice = localStorage.getItem('kl-theme') || 'system';
  } catch (e) {}
  var dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // The phone's address bar takes the page's background color (the same --bg as in styles.css), so it matches at once.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0d0e11' : '#f6f7fb');
})();
