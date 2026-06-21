const config = window.TELCO_CONFIG;
const tokenStorageKey = 'telco_demo_access_token';
const verifierStorageKey = 'telco_demo_pkce_verifier';

const els = {
  landingView: document.querySelector('#landingView'),
  homeView: document.querySelector('#homeView'),
  loginButton: document.querySelector('#loginButton'),
  heroLoginButton: document.querySelector('.hero-login-button'),
  devLoginButton: document.querySelector('#devLoginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  openChatButton: document.querySelector('#openChatButton'),
  closeChatButton: document.querySelector('#closeChatButton'),
  firstNameGreeting: document.querySelector('#firstNameGreeting'),
  chatDrawer: document.querySelector('#chatDrawer'),
  chatMessages: document.querySelector('#chatMessages'),
  chatForm: document.querySelector('#chatForm'),
  chatInput: document.querySelector('#chatInput')
};

function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

function accessToken() {
  return sessionStorage.getItem(tokenStorageKey);
}

function setAccessToken(token) {
  sessionStorage.setItem(tokenStorageKey, token);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken() ? { authorization: `Bearer ${accessToken()}` } : {}),
      ...(options.headers ?? {})
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? data?.error ?? `HTTP ${response.status}`);
  }
  return data;
}

async function login() {
  if (config.noSecurity) {
    await devLogin();
    return;
  }

  if (!config.authorizationEndpoint || !config.clientId) {
    alert('OIDC is not configured. Set OIDC_DISCOVERY_URI and OIDC_CLIENT_ID.');
    return;
  }

  const verifier = randomString(48);
  const challenge = base64Url(await sha256(verifier));
  sessionStorage.setItem(verifierStorageKey, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: randomString(24)
  });

  location.assign(`${config.authorizationEndpoint}?${params.toString()}`);
}

async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;

  const verifier = sessionStorage.getItem(verifierStorageKey);
  if (!verifier) {
    throw new Error('Login session expired. Start login again.');
  }

  const token = await api('/api/oidc/token', {
    method: 'POST',
    body: JSON.stringify({
      redirectUri: config.redirectUri,
      code,
      codeVerifier: verifier
    })
  });

  if (!token.access_token) {
    throw new Error('Token exchange did not return an access token.');
  }

  setAccessToken(token.access_token);
  sessionStorage.removeItem(verifierStorageKey);
  history.replaceState({}, document.title, '/');
}

async function devLogin() {
  const token = await api('/api/dev-token', { method: 'POST' });
  setAccessToken(token.access_token);
  await render();
}

function showHome() {
  els.landingView.classList.add('hidden');
  els.homeView.classList.remove('hidden');
  els.loginButton.classList.add('hidden');
  els.heroLoginButton.classList.add('hidden');
  els.devLoginButton.classList.add('hidden');
  els.logoutButton.classList.remove('hidden');
}

function showLanding() {
  els.homeView.classList.add('hidden');
  els.landingView.classList.remove('hidden');
  els.loginButton.classList.remove('hidden');
  if (config.noSecurity) {
    els.devLoginButton.classList.remove('hidden');
  }
  els.logoutButton.classList.add('hidden');
  els.firstNameGreeting.textContent = '';
}

function firstNameFromProfile(profile) {
  const claimName = profile?.claims?.givenName || profile?.claims?.name || profile?.claims?.username;
  if (!claimName) return '';
  return String(claimName).trim().split(/\s+/)[0];
}

function appendMessage(role, text) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  els.chatMessages.appendChild(node);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function sendChat(message) {
  appendMessage('user', message);
  appendMessage('agent', 'Checking your account...');
  const pending = els.chatMessages.lastElementChild;
  try {
    const response = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    pending.textContent = response.message;
    if (response.approval?.status === 'approval_pending') {
      pollApproval(response.approval, pending);
    }
  } catch (error) {
    pending.textContent = error.message;
  }
}

function pollApproval(approval, messageNode) {
  const pollAfterMs = Math.max(Number(approval.pollAfterSeconds ?? 3), 1) * 1000;
  const approvalId = approval.approvalId;
  const poll = async () => {
    try {
      const status = await api(`/api/approvals/${encodeURIComponent(approvalId)}`);
      if (status.status === 'approval_pending') {
        messageNode.textContent = `${status.message}\n\nWaiting for approval...`;
        setTimeout(poll, Math.max(Number(status.pollAfterSeconds ?? 3), 1) * 1000);
        return;
      }

      messageNode.textContent = status.message ?? `Approval status: ${status.status}`;
    } catch (error) {
      messageNode.textContent = error.message;
    }
  };

  setTimeout(poll, pollAfterMs);
}

async function render() {
  if (!accessToken()) {
    showLanding();
    return;
  }

  try {
    const profile = await api('/api/me');
    const firstName = firstNameFromProfile(profile);
    els.firstNameGreeting.textContent = firstName ? `, ${firstName}` : '';
    showHome();
  } catch {
    sessionStorage.removeItem(tokenStorageKey);
    showLanding();
  }
}

els.loginButton.addEventListener('click', login);
els.heroLoginButton.addEventListener('click', login);
els.devLoginButton.addEventListener('click', devLogin);
els.logoutButton.addEventListener('click', () => {
  sessionStorage.clear();
  showLanding();
});
els.openChatButton.addEventListener('click', () => {
  els.chatDrawer.classList.remove('hidden');
  if (!els.chatMessages.childElementCount) {
    appendMessage('agent', 'Hi, I can help with your plan, usage, devices, bill, and payments.');
  }
});
els.closeChatButton.addEventListener('click', () => els.chatDrawer.classList.add('hidden'));
els.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = els.chatInput.value.trim();
  if (!message) return;
  els.chatInput.value = '';
  await sendChat(message);
});

if (config.noSecurity) {
  els.devLoginButton.classList.remove('hidden');
}

handleCallback()
  .then(render)
  .catch((error) => {
    console.error(error);
    alert(error.message);
    showLanding();
  });
