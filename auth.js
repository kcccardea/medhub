// MedHub v2 — MSAL sign-in (redirect flow). Milestone 3.
// Depends on:
//   - window.MEDHUB_CONFIG from config.js (clientId, tenantId)
//   - msal global from @azure/msal-browser 3.27.0 (CDN, loaded in index.html)

(function () {
  const cfg = window.MEDHUB_CONFIG;
  if (!cfg || !cfg.clientId || !cfg.tenantId || cfg.clientId === 'REPLACE_ME') {
    console.error('[MedHub] config.js missing or contains placeholder values. Fill in real Entra clientId and tenantId in config.js.');
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
      window.dispatchEvent(new CustomEvent('medhub-signed-in'));
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

  // Returns an access token for the given scopes. Tries silent acquisition first;
  // on InteractionRequiredAuthError, falls back to redirect sign-in per M4.3 spec.
  async function acquireToken(scopes) {
    if (!app) throw new Error('MSAL not initialized.');
    const account = getAccount();
    if (!account) throw new Error('No active account; sign in first.');
    try {
      const result = await app.acquireTokenSilent({ scopes, account });
      return result.accessToken;
    } catch (err) {
      if (err instanceof msal.InteractionRequiredAuthError) {
        console.info('[MedHub auth] silent token failed; falling back to redirect sign-in');
        await app.acquireTokenRedirect({ scopes });
        // acquireTokenRedirect navigates away from the page, so any code after this
        // line never executes. Returning a never-resolving Promise prevents the
        // caller from proceeding with an undefined token during the redirect
        // transition. The flow restarts on the post-redirect page when init() runs
        // again and handleRedirectPromise() picks up the new token.
        return new Promise(function () {});
      }
      throw err;
    }
  }

  window.medhubAuth = { signIn, signOut, getAccount, acquireToken };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
