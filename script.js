/* Kanai client events and username/location onboarding. */
(() => {
  'use strict';

  const WEBHOOK_URL = 'https://n8n.krf-studio.com/webhook/2a849483-3467-4ca5-ae04-b53de826226e';
  const usernameInput = document.getElementById('username-input');
  const entryForm = document.getElementById('entry-form');
  const btnPlay = document.getElementById('btn-play');
  const btnPlayText = document.getElementById('btn-play-text');
  const usernameError = document.getElementById('username-error');
  const screenUsername = document.getElementById('screen-username');
  const screenGame = document.getElementById('screen-game');
  const sessionId = window.crypto?.randomUUID?.() || `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const sessionStartedAt = Date.now();
  let user = { username: '', country: '', countryCode: '', flag: 'UN' };
  let currentLocation = null;
  let sessionStarted = false;
  let sessionEnded = false;
  let eventSequence = 0;
  let locationRequestStartedAt = null;

  const cleanCountryCode = code => code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : 'UN';
  function clientContext() {
    const width = window.innerWidth;
    const screenInfo = window.screen || {};
    const viewport = window.visualViewport;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    const referrerOrigin = (() => {
      try { return document.referrer ? new URL(document.referrer).origin : 'direct'; }
      catch (_) { return 'unavailable'; }
    })();
    return {
      browser: {
        platform: navigator.userAgentData?.platform || navigator.platform || 'unknown',
        brands: navigator.userAgentData?.brands?.map(item => item.brand) || [],
        mobile: navigator.userAgentData?.mobile ?? (width < 600),
      },
      language: navigator.language || 'unknown',
      languages: navigator.languages || [],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      viewport: {
        width,
        height: window.innerHeight,
        visualWidth: viewport?.width ?? width,
        visualHeight: viewport?.height ?? window.innerHeight,
        scale: viewport?.scale ?? 1,
      },
      display: {
        width: screenInfo.width || null,
        height: screenInfo.height || null,
        availableWidth: screenInfo.availWidth || null,
        availableHeight: screenInfo.availHeight || null,
        pixelRatio: window.devicePixelRatio || 1,
        colorDepth: screenInfo.colorDepth || null,
        orientation: screenInfo.orientation?.type || 'unknown',
      },
      deviceClass: width < 600 ? 'mobile' : width < 1000 ? 'tablet' : 'desktop',
      input: { touchSupported: 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0, maxTouchPoints: navigator.maxTouchPoints || 0 },
      network: {
        online: navigator.onLine,
        effectiveType: connection?.effectiveType || null,
        downlinkMbps: connection?.downlink || null,
        rttMs: connection?.rtt || null,
        saveData: connection?.saveData ?? null,
        apiAvailable: !!connection,
      },
      runtime: {
        secureContext: window.isSecureContext,
        visibility: document.visibilityState,
        geolocationSupported: !!navigator.geolocation,
        userAgentDataAvailable: !!navigator.userAgentData,
      },
      page: {
        origin: window.location.origin,
        path: window.location.pathname,
        title: document.title,
        referrerOrigin,
      },
      performance: navigation ? {
        navigationType: navigation.type,
        redirectCount: navigation.redirectCount,
        domInteractiveMs: Math.round(navigation.domInteractive),
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        loadCompleteMs: navigation.loadEventEnd ? Math.round(navigation.loadEventEnd) : null,
        transferBytes: navigation.transferSize || null,
      } : null,
    };
  }
  function send(event, details = {}) {
    eventSequence += 1;
    const payload = {
      schemaVersion: '1.0',
      app: 'Kanai',
      event,
      eventId: window.crypto?.randomUUID?.() || (sessionId + '-' + eventSequence),
      eventSequence,
      timestamp: new Date().toISOString(),
      timestampUnixMs: Date.now(),
      sessionId,
      sessionDurationSec: Math.round((Date.now() - sessionStartedAt) / 1000),
      sessionPhase: sessionStarted ? 'playing' : 'entry',
      user: { username: user.username, country: user.country, countryCode: user.countryCode },
      client: clientContext(),
      ...(currentLocation ? { latitude: currentLocation.latitude, longitude: currentLocation.longitude, location: currentLocation, locationSource: 'browser_geolocation' } : {}),
      ...details,
    };
    return fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(error => ({ ok: false, error: String(error?.message || 'webhook_unavailable') }));
  }
  window.kanaiWebhook = send;
  window.kanaiProfile = () => ({ ...user });

  function startGame() {
    screenUsername.hidden = true;
    screenGame.hidden = false;
    requestAnimationFrame(() => screenGame.classList.add('active'));
    if (!sessionStarted) {
      sessionStarted = true;
      send('session_start', { game: 'Texas Hold’em', entryMethod: 'username' });
    }
    window.dispatchEvent(new CustomEvent('kanai:start', { detail: { ...user } }));
  }
  function saveProfile() {
    try {
      localStorage.setItem(`kanai_profile_${user.username.toLowerCase()}`, JSON.stringify({ country: user.country, countryCode: user.countryCode, flag: user.flag }));
    } catch (_) {}
  }
  function applyWebhookCountry(response) {
    if (!response?.ok) return;
    response.json().then(body => {
      let result = Array.isArray(body) ? (body[0] || {}) : body;
      result = result?.data || result || {};
      const code = cleanCountryCode(result.countryCode || result.country_code || result.country?.code);
      if (code === 'UN') return;
      user.countryCode = code;
      user.country = typeof result.country === 'string' ? result.country : (result.countryName || '');
      user.flag = code;
      saveProfile();
      window.dispatchEvent(new CustomEvent('kanai:profile-updated', { detail: { ...user } }));
    }).catch(() => {});
  }
  function resolveLocation(position) {
    if (!position?.coords) return;
    const { latitude, longitude, accuracy } = position.coords;
    const timeToFixMs = locationRequestStartedAt === null ? null : Math.round(performance.now() - locationRequestStartedAt);
    const location = {
      latitude, longitude, accuracyMeters: accuracy,
      altitudeMeters: position.coords.altitude,
      altitudeAccuracyMeters: position.coords.altitudeAccuracy,
      headingDegrees: position.coords.heading,
      speedMetersPerSecond: position.coords.speed,
      fixTimestamp: new Date(position.timestamp).toISOString(),
      coordinateReferenceSystem: 'WGS84',
    };
    currentLocation = location;
    send('location_response', {
      allowed: true,
      latitude,
      longitude,
      location,
      locationSource: 'browser_geolocation',
      precisionRequested: { highAccuracy: true, maximumAgeMs: 0, timeoutMs: 120000 },
      timeToFixMs,
      permissionState: 'granted',
    }).then(applyWebhookCountry);
  }
  function rejectLocation(error) {
    const reasons = { 1: 'permission_denied', 2: 'position_unavailable', 3: 'timeout' };
    send('location_response', {
      allowed: false,
      locationSource: 'browser_geolocation',
      errorCode: error?.code || 0,
      reason: reasons[error?.code] || (navigator.geolocation ? 'location_error' : 'unsupported'),
      permissionState: error?.code === 1 ? 'denied' : 'unknown',
      precisionRequested: { highAccuracy: true, maximumAgeMs: 0, timeoutMs: 120000 },
      timeToFixMs: locationRequestStartedAt === null ? null : Math.round(performance.now() - locationRequestStartedAt),
    });
  }
  function requestLocation() {
    if (!navigator.geolocation) {
      rejectLocation(null);
      return;
    }
    locationRequestStartedAt = performance.now();
    navigator.geolocation.getCurrentPosition(resolveLocation, rejectLocation, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 120000,
    });
  }
  function submitUsername() {
    const username = usernameInput.value.trim();
    usernameError.hidden = true;
    if (!username) {
      usernameError.textContent = 'Please enter a player name.';
      usernameError.hidden = false;
      usernameInput.focus();
      return;
    }
    if (!/^[\p{L}\p{N}_ -]{2,20}$/u.test(username)) {
      usernameError.textContent = 'Use 2–20 letters, numbers, spaces, _ or -.';
      usernameError.hidden = false;
      usernameInput.focus();
      return;
    }
    user.username = username;
    try {
      const saved = JSON.parse(localStorage.getItem(`kanai_profile_${username.toLowerCase()}`) || '{}');
      user = { ...user, ...saved, username, countryCode: cleanCountryCode(saved.countryCode) };
      user.flag = user.countryCode;
    } catch (_) {}

    btnPlay.disabled = true;
    btnPlayText.textContent = 'Entering table…';
    startGame();
    requestLocation();
  }

  window.kanaiGetGameSummary = () => (typeof window.kanaiSessionSummary === 'function' ? window.kanaiSessionSummary() : {});
  window.addEventListener('error', event => {
    send('client_error', { error: { type: 'window_error', message: String(event.message || 'unknown').slice(0, 500), file: String(event.filename || '').split('/').pop(), line: event.lineno || null, column: event.colno || null } });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    send('client_error', { error: { type: 'unhandled_rejection', name: String(reason?.name || 'Error').slice(0, 100), message: String(reason?.message || reason || 'unknown').slice(0, 500) } });
  });
  const reportClientState = change => send('client_state_change', {
    change,
    state: {
      visibility: document.visibilityState,
      online: navigator.onLine,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      orientation: window.screen?.orientation?.type || 'unknown',
    },
  });
  document.addEventListener('visibilitychange', () => reportClientState('visibility'));
  window.addEventListener('online', () => reportClientState('online'));
  window.addEventListener('offline', () => reportClientState('offline'));
  window.addEventListener('orientationchange', () => reportClientState('orientation'));
  let resizeReportTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeReportTimer);
    resizeReportTimer = setTimeout(() => reportClientState('resize'), 400);
  });
  window.addEventListener('pagehide', () => {
    if (sessionEnded || !sessionStarted) return;
    sessionEnded = true;
    send('session_end', { summary: window.kanaiGetGameSummary() });
  });
  entryForm.addEventListener('submit', event => { event.preventDefault(); submitUsername(); });
  usernameInput.addEventListener('input', () => { usernameError.hidden = true; });
  usernameInput.focus();
  send('page_visit', { action: 'page_loaded' });
})();
