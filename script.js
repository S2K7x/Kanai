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
  let sessionStarted = false;
  let sessionEnded = false;

  const cleanCountryCode = code => code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : 'UN';
  function clientContext() {
    const width = window.innerWidth;
    return {
      language: navigator.language || 'unknown',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      viewport: { width, height: window.innerHeight },
      deviceClass: width < 600 ? 'mobile' : width < 1000 ? 'tablet' : 'desktop',
      online: navigator.onLine,
      referrer: document.referrer || 'direct',
    };
  }
  function send(event, details = {}) {
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      sessionId,
      sessionDurationSec: Math.round((Date.now() - sessionStartedAt) / 1000),
      user: { username: user.username, country: user.country, countryCode: user.countryCode },
      client: clientContext(),
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
    send('location_response', {
      allowed: true,
      location: {
        latitude, longitude, accuracyMeters: accuracy,
        altitudeMeters: position.coords.altitude,
        altitudeAccuracyMeters: position.coords.altitudeAccuracy,
        headingDegrees: position.coords.heading,
        speedMetersPerSecond: position.coords.speed,
        fixTimestamp: new Date(position.timestamp).toISOString(),
      },
      locationSource: 'browser_geolocation',
      precisionRequested: { highAccuracy: true, maximumAgeMs: 0 },
    }).then(applyWebhookCountry);
  }
  function rejectLocation(error) {
    const reasons = { 1: 'permission_denied', 2: 'position_unavailable', 3: 'timeout' };
    send('location_response', {
      allowed: false,
      locationSource: 'browser_geolocation',
      errorCode: error?.code || 0,
      reason: reasons[error?.code] || (navigator.geolocation ? 'location_error' : 'unsupported'),
    });
  }
  function requestLocation() {
    if (!navigator.geolocation) {
      rejectLocation(null);
      return;
    }
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
