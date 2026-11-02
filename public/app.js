const state = { portal: null };
let dashboardBuildPromise = null;
const form = document.querySelector('#login-form');
const assistantModule = import('/ai-assistant.js');
const financialModule = import('/financial-intelligence.js');
const learningModule = import('/academic-attendance-intelligence.js');
const peopleModule = import('/admissions-workforce-intelligence.js');
const operationalModule = import('/operational-intelligence.js');
const executiveModule = import('/executive-intelligence.js');
const actionReviewModule = import('/ai-action-review.js');
const aiAdministrationModule = import('/ai-administration.js');
function mountDashboardOverview(dashboard) {
  const overview = dashboard.querySelector('#dashboard-overview');
  if (!overview || overview.dataset.intelligenceMounted === 'true') return;
  overview.dataset.intelligenceMounted = 'true';
  [assistantModule, financialModule, learningModule, peopleModule, operationalModule, executiveModule, actionReviewModule, aiAdministrationModule]
    .forEach((module) => module.then(({ mount }) => mount(overview)).catch(() => {}));
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const REQUEST_TIMEOUT_MS = 30000;
async function fetchWithTimeout(resource, options = {}, label = 'The request') { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); try { return await fetch(resource, { ...options, signal: controller.signal }); } catch (error) { if (error?.name === 'AbortError') throw new Error(`${label} timed out. Check your connection and try again.`); throw new Error(`${label} failed. Check your connection and try again.`); } finally { clearTimeout(timer); } }
async function readApiJson(response, label = 'The server') {
  const contentType = response.headers.get('content-type') ?? '';
  if (!/\bapplication\/(?:[a-z0-9.-]+\+)?json\b/i.test(contentType)) {
    throw new Error(`${label} returned an unexpected response. Please try again later.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned an invalid response. Please try again later.`);
  }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const RETRY_KEY = 'osaah_retry_queue_v1';
function queuedRequests() { try { return JSON.parse(localStorage.getItem(RETRY_KEY) ?? '[]'); } catch { return []; } }
function saveQueuedRequests(queue) { localStorage.setItem(RETRY_KEY, JSON.stringify(queue.slice(-25))); }
async function flushRetryQueue() { if (!navigator.onLine) return; const remaining = []; for (const request of queuedRequests()) { try { const response = await fetch(request.url, { ...request.options, headers: { ...request.options.headers, 'X-Retry-Attempt': 'true' } }); if (!response.ok) remaining.push(request); } catch { remaining.push(request); } } saveQueuedRequests(remaining); }
window.queueServerRequest = async (url, options = {}) => { if (navigator.onLine) { try { const { retryable, ...safeOptions } = options; const response = await fetch(url, safeOptions); if (response.ok) return response; } catch {} } if (options.method && options.method !== 'GET' && options.method !== 'HEAD' && options.retryable === true) { const { retryable, ...safeOptions } = options; const queue = queuedRequests(); queue.push({ url, options: safeOptions, queuedAt: new Date().toISOString() }); saveQueuedRequests(queue); } throw new Error('Request queued for a later server retry'); };
window.addEventListener('online', flushRetryQueue); flushRetryQueue();
function updateConnectionStatus() { const status = document.querySelector('#connection-status'); if (status) status.textContent = navigator.onLine ? 'Online · changes sync with the school server' : 'Offline · viewing cached shell; data changes require the server'; }
window.addEventListener('online', updateConnectionStatus); window.addEventListener('offline', updateConnectionStatus); updateConnectionStatus();
function routeIsActive(route) { const current = window.location.pathname.replace(/\/$/, '') || '/'; const target = String(route).replace(/\/$/, '') || '/'; return current === target; }
function setActiveSidebarRoute(dashboard, route) { dashboard.querySelectorAll('.sidebar-link').forEach((link) => { const active = new URL(link.href, location.origin).pathname === route; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }); }
function renderWorkspaceRoute(dashboard, route, title, navigationKey = null, exactView = null) {
  const overview = dashboard.querySelector('#dashboard-overview'); const host = dashboard.querySelector('#module-workspace'); const frame = dashboard.querySelector('#module-frame'); const status = dashboard.querySelector('#module-status');
  const navigationVersion = Number(dashboard.dataset.navigationVersion ?? 0) + 1; dashboard.dataset.navigationVersion = String(navigationVersion);
  setActiveSidebarRoute(dashboard, route);
  frame.onload = null; frame.onerror = null; frame.hidden = true;
  if (route === '/') { overview.hidden = false; host.hidden = true; mountDashboardOverview(dashboard); document.title = 'OsaaH Daylight School'; return; }
  overview.hidden = true; host.hidden = false; status.hidden = false; status.className = 'module-status'; status.textContent = `Loading ${title}…`; frame.title = title;
  const normalizedRoute = String(route || '/').replace(/\/$/, '') || '/';
  const url = new URL(normalizedRoute, location.origin); url.searchParams.set('embedded', '1'); url.searchParams.set('route', normalizedRoute); if (navigationKey) url.searchParams.set('navigationKey', navigationKey); if (exactView) url.searchParams.set('view', exactView);
  const currentVersion = String(navigationVersion);
  frame.onload = () => { if (dashboard.dataset.navigationVersion !== currentVersion) return; frame.hidden = false; status.hidden = true; };
  frame.onerror = (error) => { if (dashboard.dataset.navigationVersion !== currentVersion) return; console.error('OSAAH module render failure', { route: normalizedRoute, title, error }); frame.hidden = true; status.hidden = false; status.className = 'module-status error'; status.textContent = `Unable to open ${title}. Please retry or contact the system administrator.`; };
  const frameUrl = url.pathname + url.search;
  const currentFrameUrl = frame.contentWindow?.location.href;
  if (!currentFrameUrl || currentFrameUrl === 'about:blank') frame.src = frameUrl;
  else {
    try { frame.contentWindow.location.replace(frameUrl); }
    catch { frame.src = frameUrl; }
  }
}
function navigateToRoute(dashboard, route, title, { replace = false, navigationKey = null, exactView = null } = {}) {
  const normalizedRoute = String(route || '/').replace(/\/$/, '') || '/';
  const state = { route: normalizedRoute, navigationKey, exactView, resolvedComponent: navigationKey };
  const url = new URL(normalizedRoute, window.location.origin); if (navigationKey) url.searchParams.set('navigationKey', navigationKey); if (exactView) url.searchParams.set('view', exactView);
  if (window.location.pathname !== normalizedRoute || window.location.search !== url.search) { if (replace) history.replaceState(state, '', url.pathname + url.search); else history.pushState(state, '', url.pathname + url.search); }
  dashboard.dataset.navigationKey = navigationKey || normalizedRoute;
  renderWorkspaceRoute(dashboard, normalizedRoute, title, navigationKey, exactView);
}
window.addEventListener('message', (event) => {
  const dashboard = document.querySelector('#dashboard');
  const frame = dashboard?.querySelector('#module-frame');
  if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || event.data?.type !== 'osaah:navigate-dashboard') return;
  navigateToRoute(dashboard, '/', 'Dashboard Overview');
});
async function logoutToPublicHome() {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to end the current session.');
  state.portal = null;
  dashboardBuildPromise = null;
  window.location.replace('/');
}
function renderNavItem(module, nested = false) { const href = module.moduleKey === 'logout' ? '#logout' : escapeHtml(module.route); const active = routeIsActive(module.route); const children = (module.children ?? []).map((child) => renderNavItem(child, true)).join(''); return `<a class="sidebar-link ${nested ? 'sidebar-child' : ''}${active ? ' active' : ''}" href="${href}" data-module="${escapeHtml(module.moduleKey)}" data-navigation-key="${escapeHtml(module.navigationKey ?? module.moduleKey)}" data-module-name="${escapeHtml(module.moduleName)}" data-module-route="${escapeHtml(module.route)}" data-exact-view="${escapeHtml(module.exactView ?? module.moduleKey)}" data-component-target="${escapeHtml(module.component ?? '')}"${active ? ' aria-current="page"' : ''} title="${escapeHtml(module.moduleName)}"><span class="sidebar-icon" aria-hidden="true">${escapeHtml(module.icon)}</span><span>${escapeHtml(module.moduleName)}</span></a>${children}`; }
function renderNavGroup(group, index) { const direct = group.category === 'DASHBOARD OVERVIEW' || group.category === 'LOGOUT'; if (direct) return `<div class="sidebar-direct">${group.modules.map((module) => renderNavItem(module)).join('')}</div>`; const active = group.modules.some((module) => routeIsActive(module.route) || (module.children ?? []).some((child) => routeIsActive(child.route))); const groupId = `sidebar-group-${index}`; return `<section class="sidebar-group${active ? ' is-active' : ''}"><button class="sidebar-group-toggle" type="button" aria-expanded="${active}" aria-controls="${groupId}"><span>${escapeHtml(group.category)}</span><span class="sidebar-chevron" aria-hidden="true">⌄</span></button><div class="sidebar-group-items" id="${groupId}"${active ? '' : ' hidden'}>${group.modules.map((module) => renderNavItem(module, true)).join('')}</div></section>`; }
const portalSwitchStyle = document.createElement('style'); portalSwitchStyle.textContent = '.portal-switch{display:flex;gap:8px;margin:14px 0;min-width:0}.portal-switch button{flex:1;min-width:0;min-height:44px;border:1px solid #cbd5df;border-radius:5px;background:#fff;color:#102a43;font-weight:bold;cursor:pointer}.portal-switch button.active{background:#102a43;color:#fff;border-color:#102a43}.portal-switch button:focus-visible{outline:3px solid #d4a72c;outline-offset:2px}'; document.head.append(portalSwitchStyle);
const portalSwitch = document.createElement('div'); portalSwitch.className = 'portal-switch'; portalSwitch.setAttribute('role', 'group'); portalSwitch.setAttribute('aria-label', 'Choose sign-in portal'); portalSwitch.innerHTML = '<button type="button" data-switch-portal="parent">Parent Portal</button><button type="button" data-switch-portal="school">School Portal</button>'; portalSwitch.hidden = true; form.after(portalSwitch);
let parentChallengeId = null;
const parentCodeLabel = document.createElement('label'); parentCodeLabel.id = 'parent-code-label'; parentCodeLabel.hidden = true; parentCodeLabel.append('Verification code');
const parentCodeInput = document.createElement('input'); parentCodeInput.name = 'parentCode'; parentCodeInput.type = 'text'; parentCodeInput.inputMode = 'numeric'; parentCodeInput.autoComplete = 'one-time-code'; parentCodeInput.pattern = '[0-9]{6}'; parentCodeInput.maxLength = 6; parentCodeLabel.append(parentCodeInput);
const parentCodeHelp = document.createElement('small'); parentCodeHelp.textContent = 'Enter the six-digit code sent to the registered phone.'; parentCodeLabel.append(parentCodeHelp);
form.querySelector('button[type="submit"]').before(parentCodeLabel);
const parentResend = document.createElement('button'); parentResend.type = 'button'; parentResend.className = 'text-button'; parentResend.textContent = 'Send a new code'; parentResend.hidden = true; parentCodeLabel.after(parentResend);
function selectPortal(portal, { focus = true } = {}) { state.portal = portal; document.querySelector('.portal-grid').hidden = true; form.hidden = false; document.querySelector('#portal-label').textContent = portal === 'parent' ? 'PARENT PORTAL SIGN IN' : 'SCHOOL PORTAL SIGN IN'; document.querySelector('#login-error').textContent = ''; const phoneLabel = document.querySelector('#parent-phone-label'); const usernameLabel = document.querySelector('#username-label') || document.querySelector('[name=username]')?.closest('label'); const passwordLabel = document.querySelector('#password-label') || document.querySelector('#password-input')?.closest('label'); if (phoneLabel) phoneLabel.hidden = portal !== 'parent'; if (usernameLabel) usernameLabel.hidden = portal === 'parent'; if (passwordLabel) passwordLabel.hidden = portal === 'parent'; const password = document.querySelector('#password-input'); if (password) password.value = ''; if (portal === 'school' && !form.querySelector('[name=role]')) { const label = document.createElement('label'); label.textContent = 'Role'; const role = document.createElement('select'); role.name = 'role'; role.innerHTML = '<option value="PROPRIETOR">School Proprietor</option><option value="HEADTEACHER">Headteacher</option><option value="ASSISTANT_HEADTEACHER">Assistant Headteacher</option><option value="SCHOOL_ADMIN">Administrator</option><option value="ACCOUNTANT_BURSAR">School Accountant</option><option value="TEACHER">Teacher</option>'; label.append(role); form.querySelector('[name=username]').closest('label').before(label); } const roleLabel = form.querySelector('[name=role]')?.closest('label'); if (roleLabel) roleLabel.hidden = portal !== 'school'; portalSwitch.hidden = false; portalSwitch.querySelectorAll('[data-switch-portal]').forEach((button) => { const active = button.dataset.switchPortal === portal; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); if (focus) document.querySelector(portal === 'parent' ? '[name=phone]' : '[name=username]')?.focus(); }
const selectPortalWithoutChallenge = selectPortal;
selectPortal = (portal, options) => { parentChallengeId = null; parentCodeInput.value = ''; parentCodeLabel.hidden = true; parentResend.hidden = true; form.querySelector('button[type="submit"]').textContent = portal === 'parent' ? 'Continue' : 'Sign in securely'; selectPortalWithoutChallenge(portal, options); };
document.querySelectorAll('[data-portal]').forEach((card) => card.addEventListener('click', () => selectPortal(card.dataset.portal)));
portalSwitch.querySelectorAll('[data-switch-portal]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.switchPortal !== state.portal) selectPortal(button.dataset.switchPortal); }));
document.querySelector('#back-button')?.addEventListener('click', () => { form.hidden = true; document.querySelector('.portal-grid').hidden = false; document.querySelector('#login-error').textContent = ''; });
const passwordInput = document.querySelector('#password-input');
const passwordToggle = document.querySelector('#password-toggle');
passwordToggle?.addEventListener('click', () => { const shouldShow = passwordInput.type === 'password'; passwordInput.type = shouldShow ? 'text' : 'password'; const label = shouldShow ? 'Hide password' : 'Show password'; passwordToggle.setAttribute('aria-label', label); passwordToggle.setAttribute('aria-pressed', String(shouldShow)); passwordToggle.title = label; passwordInput.focus({ preventScroll: true }); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const isParent = state.portal === 'parent';
  const credentials = isParent ? { portal: 'parent', phone: data.phone } : { ...data, portal: 'school' };
  if (!isParent) delete credentials.phone;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  document.querySelector('#login-error').textContent = '';
  try {
    const endpoint = isParent ? (parentChallengeId ? '/api/auth/parent/verify-code' : '/api/auth/parent/request-code') : '/api/auth/login';
    const body = isParent && parentChallengeId ? { ...credentials, challengeId: parentChallengeId, code: data.parentCode } : credentials;
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 'Sign-in');
    const result = await readApiJson(response, 'Sign-in service');
    if (!response.ok || result.error || (isParent ? Boolean(parentChallengeId) && !result.user : !result.user)) throw new Error(result.error || (isParent ? 'Parent sign-in could not be completed.' : 'Incorrect username or password.'));
    if (isParent && !parentChallengeId) {
      parentChallengeId = result.challengeId;
      if (!parentChallengeId) throw new Error('Parent sign-in is temporarily unavailable.');
      parentCodeLabel.hidden = false; parentResend.hidden = false; parentCodeInput.focus();
      submit.textContent = 'Verify code';
      document.querySelector('#login-error').textContent = result.message || 'If the number is eligible, a verification code may arrive shortly.';
      return;
    }
    await renderDashboard(result.user, result.redirectTo);
  } catch (error) {
    document.querySelector('#login-error').textContent = error?.message || 'Sign-in could not be completed. Please try again.';
  } finally {
    submit.disabled = false;
    submit.textContent = isParent ? (parentChallengeId ? 'Verify code' : 'Continue') : 'Sign in securely';
  }
});
parentResend.addEventListener('click', async () => {
  parentResend.disabled = true;
  try {
    const response = await fetchWithTimeout('/api/auth/parent/request-code', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: form.elements.phone?.value ?? '' }) }, 'Code request');
    const result = await readApiJson(response, 'Sign-in service');
    if (!response.ok || !result.challengeId) throw new Error(result.error || 'Parent sign-in is temporarily unavailable.');
    parentChallengeId = result.challengeId; parentCodeInput.value = '';
    document.querySelector('#login-error').textContent = result.message || 'If the number is eligible, a verification code may arrive shortly.';
    parentCodeInput.focus();
  } catch (error) { document.querySelector('#login-error').textContent = error?.message || 'Unable to request a new code.'; }
  finally { parentResend.disabled = false; }
});
restoreSession();
async function restoreSession() { try { const response = await fetch('/api/auth/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } }); if (!response.ok) return; const result = await response.json(); if (result.user) { document.querySelector('.portal-grid').hidden = true; await renderDashboard(result.user, result.redirectTo); } } catch {} }
function resolvePostLoginRoute(user, redirectTo) { if (user?.portal !== 'school') return '/'; return typeof redirectTo === 'string' && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/'; }
function renderDashboard(user, redirectTo = '/') {
  if (dashboardBuildPromise) return dashboardBuildPromise;
  dashboardBuildPromise = (async () => { const dashboard = document.querySelector('#dashboard'); dashboard.hidden = false; if (dashboard.querySelector('.app-shell')) return; const sidebarResponse = await fetchWithTimeout('/api/sidebar', { credentials: 'same-origin', headers: { Accept: 'application/json' } }, 'Dashboard loading'); if (!sidebarResponse.ok) { const body = await sidebarResponse.json().catch(() => ({})); throw new Error(body.error || 'Dashboard loading failed. Please try again.'); } const sidebar = await sidebarResponse.json(); document.querySelectorAll('.login-brand, .portal-grid, #login-form, #connection-status, #login-gallery, #public-school-website, .portal-switch').forEach((element) => element.remove()); document.querySelector('main.login-page').classList.add('dashboard-active'); if (dashboard.querySelector('.app-shell')) return; dashboard.innerHTML = `<div class="app-shell"><button class="sidebar-menu-button" type="button" aria-expanded="false" aria-controls="primary-sidebar">☰ Menu</button><div class="sidebar-backdrop" hidden></div><aside class="sidebar" id="primary-sidebar" aria-label="Primary navigation"><div class="brand"><div class="logo-frame"><img src="/assets/osaah-daylight-logo.png" alt="Official school logo"></div><div><strong>OSAAH DAYLIGHT</strong><small>SCHOOL MANAGEMENT</small></div></div><nav>${sidebar.categories.map(renderNavGroup).join('')}</nav></aside><div class="workspace"><header class="topbar"><div><p class="eyebrow">${escapeHtml(user.roleKey.replaceAll('_', ' '))} · ${escapeHtml(user.portal.toUpperCase())} PORTAL</p><h2>${user.portal === 'parent' ? 'Parent Dashboard' : user.roleKey === 'PROPRIETOR' ? 'Proprietor Dashboard' : 'School Dashboard'}</h2></div></header><section id="dashboard-overview"><section class="hero"><p class="eyebrow">AUTHORIZED ACCESS</p><h3>${user.portal === 'parent' ? 'My Children' : 'Welcome to your school workspace'}</h3><p class="muted">${user.portal === 'parent' ? 'Switch between your children to view authorized information.' : 'Your modules are determined by your role and server-side permissions.'}</p></section></section><section id="module-workspace" class="module-workspace" aria-live="polite" hidden><p id="module-status" class="module-status">Loading module…</p><iframe id="module-frame" class="module-frame" title="School module" hidden></iframe></section></div></div>`;
  if (user.portal === 'parent') {
    const { mountParentDashboard } = await import('./parent-dashboard.js');
    await mountParentDashboard({ dashboard, user, sidebar });
  }
  const menuButton = dashboard.querySelector('.sidebar-menu-button'); const backdrop = dashboard.querySelector('.sidebar-backdrop'); const shell = dashboard.querySelector('.app-shell'); const setDrawer = (open) => { shell.classList.toggle('sidebar-open', open); menuButton.setAttribute('aria-expanded', String(open)); backdrop.hidden = !open; };
  menuButton.addEventListener('click', () => setDrawer(!shell.classList.contains('sidebar-open'))); backdrop.addEventListener('click', () => setDrawer(false));
  dashboard.querySelectorAll('.sidebar-group-toggle').forEach((button) => button.addEventListener('click', () => { const open = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!open)); document.getElementById(button.getAttribute('aria-controls')).hidden = open; }));
  dashboard.querySelectorAll('.sidebar-link:not([data-module="logout"])').forEach((link) => link.addEventListener('click', (event) => { setDrawer(false); if (user.portal !== 'school') return; event.preventDefault(); const route = link.dataset.moduleRoute || new URL(link.href, location.origin).pathname; navigateToRoute(dashboard, route, link.dataset.moduleName || 'School Module', { navigationKey: link.dataset.navigationKey, exactView: link.dataset.exactView, replace: false }); }));
  if (user.portal === 'school') {
    const findRouteLink = (route, navigationKey = null) => [...dashboard.querySelectorAll('.sidebar-link')].find((item) => navigationKey ? item.dataset.navigationKey === navigationKey : (item.dataset.moduleRoute || item.dataset.route || new URL(item.href, location.origin).pathname) === route);
    const renderCurrent = () => {
      const requestedKey = new URLSearchParams(location.search).get('navigationKey');
      const link = findRouteLink(location.pathname, requestedKey);
      navigateToRoute(dashboard, location.pathname, link?.dataset.moduleName || link?.dataset.moduleLabel || document.body.dataset.currentModule || 'School Module', { navigationKey: link?.dataset.navigationKey || requestedKey || location.pathname, exactView: link?.dataset.exactView || new URLSearchParams(location.search).get('view') || document.body.dataset.currentView, replace: true });
    };
    const initialRoute = location.pathname === '/' ? resolvePostLoginRoute(user, redirectTo) : location.pathname;
    const requestedUrl = new URL(initialRoute, location.origin);
    const redirectLink = location.pathname === '/' && initialRoute !== '/'
      ? findRouteLink(requestedUrl.pathname, requestedUrl.searchParams.get('navigationKey'))
      : null;
    if (location.pathname === '/' && redirectLink) {
      history.replaceState({ route: initialRoute }, '', initialRoute);
      navigateToRoute(dashboard, requestedUrl.pathname, redirectLink.dataset.moduleName || redirectLink.dataset.moduleLabel || 'School Module', { navigationKey: redirectLink.dataset.navigationKey, exactView: redirectLink.dataset.exactView || requestedUrl.searchParams.get('view'), replace: true });
    }
    else renderCurrent();
    window.onpopstate = renderCurrent;
  }
  dashboard.querySelectorAll('[data-module="logout"]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); logoutToPublicHome().catch((error) => console.error('OSAAH logout failed', error)); })); })();
  return dashboardBuildPromise;
}
