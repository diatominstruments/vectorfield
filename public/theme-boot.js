// Runs before the app bundle: applies the theme remembered on this device
// so the first paint is already in it. The app re-applies the account's
// theme once the session loads. Unknown values are harmless: the
// stylesheet ignores them and falls back to the default theme.
try {
  var theme = localStorage.getItem('vectorfield.theme');
  if (theme && /^[a-z]{2,16}$/.test(theme)) document.documentElement.dataset.theme = theme;
} catch (e) {}
