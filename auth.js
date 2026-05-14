// MedHub v2 — MSAL sign-in (redirect flow). Milestone 3.
// Depends on:
//   - window.MEDHUB_CONFIG from config.js (clientId, tenantId)
//   - msal global from @azure/msal-browser 3.27.0 (CDN, loaded in index.html)

(function () {
  const cfg = window.MEDHUB_CONFIG;
  if (!cfg || !cfg.clientId || !cfg.tenantId || cfg.clientId === 'REPLACE_ME') {
    console.error('[MedHub] config.js missing or contains placeholder values. Copy config.example.js to config.js and fill in real Entra clientId and tenantId.');
    return;
  }

  // Strip a trailing filename like /index.html so the redirectUri matches the Entra-registered base URI.
  // Local: http://localhost:8000/index.html -> http://localhost:8000/
  // Prod:  https://kcccardea.github.io/medhub/ -> unchanged
  const basePath = window.location.pathname.replace(/\/[^/]*\.[^/]*$/, '/');
  const redirectUri = window.location.origin + basePath;

  const msalConfig = {
    auth: {
      clientId: cfg.clientId,
      authority: 'https://login.microsoftonline.com/' + cfg.tenantId,
      redirectUri: redirectUri,
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
  };

  const loginRequest = {
    scopes: ['Files.ReadWrite', 'User.Read'],
  };

  let app;

  async function init() {
    app = new msal.PublicClientApplication(msalConfig);
    await app.initialize();

    try {
      const result = await app.handleRedirectPromise();
      if (result && result.account) {
        app.setActiveAccount(result.account);
      } else {
        const accounts = app.getAllAccounts();
        if (accounts.length > 0 && !app.getActiveAccount()) {
          app.setActiveAccount(accounts[0]);
        }
      }
    } catch (err) {
      console.error('[MedHub] handleRedirectPromise failed:', err);
      showStatus('Sign-in error: ' + err.message);
    }

    wireButtons();
    updateUI();
  }

  function wireButtons() {
    const signInBtn = document.getElementById('sign-in-btn');
    const signOutBtn = document.getElementById('sign-out-btn');
    if (signInBtn) signInBtn.addEventListener('click', signIn);
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);
  }

  function updateUI() {
    const account = getAccount();
    const signedOutDiv = document.getElementById('signed-out');
    const signedInDiv = document.getElementById('signed-in');
    const userEmailSpan = document.getElementById('user-email');
    if (account) {
      signedOutDiv.classList.add('hidden');
      signedInDiv.classList.remove('hidden');
      userEmailSpan.textContent = account.username || account.name || '(unknown)';
    } else {
      signedInDiv.classList.add('hidden');
      signedOutDiv.classList.remove('hidden');
    }
  }

  function showStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  }

  async function signIn() {
    try {
      await app.loginRedirect(loginRequest);
    } catch (err) {
      console.error('[MedHub] loginRedirect failed:', err);
      showStatus('Sign-in error: ' + err.message);
    }
  }

  async function signOut() {
    try {
      await app.logoutRedirect();
    } catch (err) {
      console.error('[MedHub] logoutRedirect failed:', err);
      showStatus('Sign-out error: ' + err.message);
    }
  }

  function getAccount() {
    if (!app) return null;
    return app.getActiveAccount() || app.getAllAccounts()[0] || null;
  }

  window.medhubAuth = { signIn, signOut, getAccount };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
