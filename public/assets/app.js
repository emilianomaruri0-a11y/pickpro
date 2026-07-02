"use strict";

const state = {
  events: [],
  allEvents: [],
  sports: [],
  selectedId: null,
  sportKey: "all",
  view: "home",
  parlayOpen: false,
  profileHandleDirty: false,
  aiMessages: [],
  payload: null,
  csrfToken: null,
  user: null,
  settings: { oddsFormat: "decimal", theme: "dark", bookmaker: "best" }
};

const elements = {
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  liveMatches: document.querySelector("#liveMatches"),
  upcomingMatches: document.querySelector("#upcomingMatches"),
  featuredPicks: document.querySelector("#featuredPicks"),
  platformGrid: document.querySelector("#platformGrid"),
  dailyPredictionList: document.querySelector("#dailyPredictionList"),
  comboList: document.querySelector("#comboList"),
  analysisCard: document.querySelector("#analysisCard"),
  sportTabs: document.querySelector("#sportTabs"),
  quickTags: document.querySelector("#quickTags"),
  feedMode: document.querySelector("#feedMode"),
  lastRefresh: document.querySelector("#lastRefresh"),
  statusDot: document.querySelector("#statusDot"),
  totalEvents: document.querySelector("#totalEvents"),
  averageConfidence: document.querySelector("#averageConfidence"),
  heroWinRate: document.querySelector("#heroWinRate"),
  userCount: document.querySelector("#userCount"),
  profileButton: document.querySelector("#profileButton"),
  profileUsername: document.querySelector("#profileUsername"),
  parlayShortcut: document.querySelector("#parlayShortcut"),
  hitsShortcut: document.querySelector("#hitsShortcut"),
  featuredShortcut: document.querySelector("#featuredShortcut"),
  sourcesShortcut: document.querySelector("#sourcesShortcut"),
  parlayDailyCard: document.querySelector("#parlayDailyCard"),
  dailyParlayContent: null,
  hitsPageContent: null,
  featuredPageContent: null,
  sourcesPageContent: null,
  searchAiContent: null,
  pullRefresh: document.querySelector("#pullRefresh"),
  logoutButton: document.querySelector("#logoutButton"),
  oddsFormat: document.querySelector("#oddsFormat"),
  saveSettings: document.querySelector("#saveSettings"),
  profileDetails: document.querySelector("#profileDetails"),
  profileForm: document.querySelector("#profileForm"),
  profileHandleInput: document.querySelector("#profileHandleInput"),
  profileMessage: document.querySelector("#profileMessage")
};

function setupViews() {
  const main = document.querySelector("main");
  const existingChildren = Array.from(main.children);
  const homeView = document.createElement("section");
  homeView.id = "homeView";
  homeView.className = "app-view home-view";
  existingChildren.forEach((child) => homeView.appendChild(child));
  main.appendChild(homeView);

  const accountPanels = document.querySelector(".account-panels");
  const profileView = document.createElement("section");
  profileView.id = "profileView";
  profileView.className = "app-view profile-view";
  profileView.hidden = true;
  profileView.innerHTML = `
    <div class="profile-hero">
      <div>
        <span class="ai-pill"><span class="live-dot"></span> Centro de cuenta</span>
        <h1>Perfil y seguridad</h1>
        <p>Administra tus momios, datos, privacidad y consejos de juego responsable.</p>
      </div>
    </div>
  `;
  profileView.appendChild(accountPanels);
  main.appendChild(profileView);

  const matchDetailView = document.createElement("section");
  matchDetailView.id = "matchDetailView";
  matchDetailView.className = "app-view match-detail-view";
  matchDetailView.hidden = true;
  matchDetailView.innerHTML = `<div id="matchDetailContent"></div>`;
  main.appendChild(matchDetailView);

  const dailyParlayView = document.createElement("section");
  dailyParlayView.id = "dailyParlayView";
  dailyParlayView.className = "app-view daily-parlay-view";
  dailyParlayView.hidden = true;
  dailyParlayView.innerHTML = `<div id="dailyParlayContent"></div>`;
  main.appendChild(dailyParlayView);

  const hitsView = document.createElement("section");
  hitsView.id = "hitsView";
  hitsView.className = "app-view page-view hits-view";
  hitsView.hidden = true;
  hitsView.innerHTML = `<div id="hitsPageContent"></div>`;
  main.appendChild(hitsView);

  const featuredView = document.createElement("section");
  featuredView.id = "featuredView";
  featuredView.className = "app-view page-view featured-view";
  featuredView.hidden = true;
  featuredView.innerHTML = `<div id="featuredPageContent"></div>`;
  main.appendChild(featuredView);

  const sourcesView = document.createElement("section");
  sourcesView.id = "sourcesView";
  sourcesView.className = "app-view page-view sources-view";
  sourcesView.hidden = true;
  sourcesView.innerHTML = `<div id="sourcesPageContent"></div>`;
  main.appendChild(sourcesView);

  const searchAiView = document.createElement("section");
  searchAiView.id = "searchAiView";
  searchAiView.className = "app-view page-view search-ai-view";
  searchAiView.hidden = true;
  searchAiView.innerHTML = `<div id="searchAiContent"></div>`;
  main.appendChild(searchAiView);

  elements.dailyParlayContent = dailyParlayView.querySelector("#dailyParlayContent");
  elements.hitsPageContent = hitsView.querySelector("#hitsPageContent");
  elements.featuredPageContent = featuredView.querySelector("#featuredPageContent");
  elements.sourcesPageContent = sourcesView.querySelector("#sourcesPageContent");
  elements.searchAiContent = searchAiView.querySelector("#searchAiContent");
}

setupViews();

const sportOptions = [
  { label: "MLB", value: "baseball_mlb", query: "MLB", logo: "/assets/league-mlb-official.svg" },
  { label: "Copa Mundial", value: "soccer_fifa_world_cup", query: "Copa Mundial", logo: "/assets/league-worldcup-official.svg" }
];

const mexicanBooks = [
  { name: "Mejor disponible", subtitle: "Compara todas las fuentes", logo: "*", book: "best" },
  { name: "Draftea", subtitle: "Referencia Mexico", logo: "D", book: "Draftea" },
  { name: "Playdoit", subtitle: "Referencia Mexico", logo: "P", book: "Playdoit" },
  { name: "Caliente.mx", subtitle: "Referencia Mexico", logo: "C", book: "Caliente.mx" },
  { name: "Codere", subtitle: "Referencia Mexico", logo: "CO", book: "Codere" },
  { name: "Bet350", subtitle: "Referencia Mexico", logo: "B", book: "Bet350" }
];

function selectedBookmaker() {
  return mexicanBooks.find((book) => book.book === state.settings.bookmaker) || mexicanBooks[0];
}

function selectedBookmakerName() {
  return selectedBookmaker().name;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatSignedPercent(value) {
  const rounded = Math.round((value || 0) * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function decimalToAmerican(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return "--";
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return `${Math.round(-100 / (decimal - 1))}`;
}

function formatOdds(decimal) {
  if (!Number.isFinite(decimal)) return "--";
  return state.settings.oddsFormat === "american" ? decimalToAmerican(decimal) : decimal.toFixed(2);
}

function formatTime(value) {
  if (!value) return "Sin hora";
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function elapsedGameMinutes(event) {
  const startMs = new Date(event?.commenceTime).getTime();
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 60000));
}

function liveClockText(event) {
  if (event?.status !== "live") return "";
  const minutes = elapsedGameMinutes(event);
  if (event.sportKey?.includes("soccer")) {
    if (minutes <= 45) return `1T ${Math.max(1, minutes)}'`;
    if (minutes <= 60) return "Descanso";
    const matchMinute = Math.min(90, Math.max(46, minutes - 15));
    return matchMinute >= 90 ? "2T 90+'" : `2T ${matchMinute}'`;
  }
  if (event.sportKey?.includes("baseball")) {
    const inning = Math.min(9, Math.max(1, Math.floor(minutes / 22) + 1));
    const half = Math.floor((minutes % 22) / 11) === 0 ? "Alta" : "Baja";
    return `${half} ${inning}a entrada`;
  }
  return `${minutes} min`;
}

function eventTimeHtml(event) {
  if (event.status === "live") {
    const clock = liveClockText(event);
    return `<span class="live-label live-pulse"><span class="live-beacon" aria-hidden="true"></span>En vivo${clock ? ` - ${escapeHtml(clock)}` : ""}</span>`;
  }
  const text = event.status === "final" ? event.scoreSource || "Marcador final" : formatTime(event.commenceTime);
  return `<span>${escapeHtml(text)}</span>`;
}

function eventStatusLabel(event) {
  if (event.status === "live") return "En vivo";
  if (event.status === "final") return "Final";
  return "Proximo";
}

function scoreSubline(event, pick) {
  if (event.status === "live") {
    const source = event.score ? "Marcador oficial" : "Esperando marcador oficial";
    return `${liveClockText(event)} - ${source}`;
  }
  if (event.status === "final") return event.scoreSource || "Marcador final";
  return `Prediccion: ${pick.label}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function teamLogoSrc(name) {
  return `/assets/team-logos/${slugify(name) || "team-default"}.png`;
}

function deterministicRatio(seed) {
  let hash = 0;
  const text = String(seed || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 9973;
  }
  return hash / 9973;
}

function adjustedBookOdds(decimal, book, key, eventId) {
  if (!Number.isFinite(decimal)) return null;
  const ratio = deterministicRatio(`${book}-${key}-${eventId}`);
  const adjustment = (ratio - 0.5) * 0.08;
  return Math.max(1.01, decimal + adjustment);
}

function formatRelative(value) {
  if (!value) return "Sin datos";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 3) return "IA actualizada ahora";
  if (seconds < 60) return `IA actualizada hace ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `Actualizado hace ${minutes}m`;
}

function teamCode(name) {
  return String(name)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function moneylineRows(event) {
  const hasDraw = event.markets?.h2h?.some((row) => row.draw);
  const selectedBook = state.settings.bookmaker || "best";
  const selectedRow =
    selectedBook !== "best"
      ? (event.markets?.h2h || []).find((row) => row.book === selectedBook)
      : null;
  const best = {};
  event.prediction.outcomes.forEach((outcome) => {
    best[outcome.key] = outcome;
  });

  const rows = [
    { key: "home", label: event.homeTeam },
    hasDraw ? { key: "draw", label: "Empate" } : null,
    { key: "away", label: event.awayTeam }
  ].filter(Boolean);

  return rows.map((row) => ({
    ...row,
    odds:
      selectedRow && Number.isFinite(selectedRow[row.key])
        ? selectedRow[row.key]
        : selectedBook !== "best"
          ? adjustedBookOdds(best[row.key]?.bestOdds, selectedBook, row.key, event.id)
          : best[row.key]?.bestOdds || null,
    book:
      selectedRow && Number.isFinite(selectedRow[row.key])
        ? selectedRow.book
        : selectedBook !== "best"
          ? `${selectedBook} ref.`
          : best[row.key]?.bestBook || "Mejor disponible",
    selected: row.key === event.prediction.pick.key
  }));
}

function shortScoreValue(event, side) {
  if (!event.score) return event.status === "upcoming" ? "-" : "0";
  const value = side === "home" ? event.score.home : event.score.away;
  return Number.isFinite(Number(value)) ? String(value) : "0";
}

function probabilityRows(event) {
  const labels = {
    home: event.homeTeam,
    draw: "Empate",
    away: event.awayTeam
  };
  return event.prediction.outcomes
    .map((outcome) => ({
      ...outcome,
      label: labels[outcome.key] || outcome.label,
      percent: Math.round(outcome.probability * 100)
    }))
    .sort((a, b) => {
      const order = { home: 0, draw: 1, away: 2 };
      return (order[a.key] ?? 9) - (order[b.key] ?? 9);
    });
}

function confidenceLabel(confidence) {
  if (confidence >= 78) return "Filtro fuerte";
  return confidence >= 70 ? "Alta confianza" : "Media confianza";
}

function pickSubtitle(event) {
  const pick = event.prediction.pick;
  if (pick.key === "draw") return "Empate";
  return `${pick.label} gana`;
}

function isStrictPick(event) {
  const pick = event?.prediction?.pick;
  if (!pick?.bestOdds) return false;
  if (pick.recommendation === "Vigilar") return false;
  if (pick.confidence < 72) return false;
  if (pick.risk === "Alto") return false;
  return true;
}

function strictEvents() {
  const strict = sortedEvents().filter(isStrictPick);
  return strict.length ? strict : sortedEvents().filter((event) => event.prediction?.pick?.bestOdds && event.prediction?.pick?.confidence >= 68);
}

function displayUsername(user = state.user || {}) {
  return user.handle || user.username || user.email || user.phone || "Perfil";
}

function renderHeaderUser() {
  if (!elements.profileUsername) return;
  elements.profileUsername.textContent = displayUsername();
}

async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && state.csrfToken) {
    headers["x-csrf-token"] = state.csrfToken;
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Sesion requerida");
  }

  return response;
}

async function loadSession() {
  const response = await authFetch("/api/me");
  const data = await response.json();
  state.csrfToken = data.csrfToken;
  state.user = data.user;
  state.settings = { ...state.settings, ...(data.user.settings || {}), theme: "dark" };
  elements.oddsFormat.value = state.settings.oddsFormat;
  document.body.dataset.theme = "dark";
  renderHeaderUser();
  renderProfile();
}

async function fetchEvents() {
  const response = await authFetch("/api/events");
  if (!response.ok) throw new Error("No se pudieron cargar los eventos");
  applyPayload(await response.json());
}

function applyPayload(payload) {
  state.allEvents = payload.events || [];
  state.sports = payload.sports || [];
  applyCurrentFilters(payload);
  if (!state.selectedId || !state.events.some((event) => event.id === state.selectedId)) {
    state.selectedId = state.events[0]?.id || null;
  }
  render();
}

function eventMatchesSearch(event, query) {
  if (!query) return true;
  return [
    event.eventName,
    event.homeTeam,
    event.awayTeam,
    event.league,
    event.sport,
    event.prediction?.pick?.label,
    event.prediction?.pick?.bestBook
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function buildClientSummary(events) {
  return {
    totalEvents: events.length,
    opportunities: events.filter(isStrictPick).length,
    liveEvents: events.filter((event) => event.status === "live").length,
    averageConfidence: events.length
      ? Math.round(events.reduce((sum, event) => sum + event.prediction.pick.confidence, 0) / events.length)
      : 0
  };
}

function applyCurrentFilters(payload = state.payload) {
  const query = elements.searchInput.value.trim().toLowerCase();
  state.events = state.allEvents.filter((event) => {
    const sportMatches = state.sportKey === "all" || event.sportKey === state.sportKey;
    return sportMatches && eventMatchesSearch(event, query);
  });
  state.payload = {
    ...(payload || {}),
    events: state.events,
    sports: state.sports,
    summary: buildClientSummary(state.events)
  };
}

function sortedEvents() {
  return [...state.events].sort((a, b) => {
    const liveDelta = Number(b.status === "live") - Number(a.status === "live");
    if (liveDelta) return liveDelta;
    const timeDelta = new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime();
    if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
    return b.prediction.pick.confidence - a.prediction.pick.confidence;
  });
}

function renderStatus() {
  const payload = state.payload || {};
  const summary = payload.summary || {};
  const modeLabel =
    payload.feedMode === "live"
      ? "Datos en vivo"
      : payload.feedMode === "demo-fallback"
        ? "Demo por respaldo"
        : "IA en vivo";

  elements.feedMode.textContent = modeLabel;
  elements.lastRefresh.textContent = formatRelative(payload.lastRefreshAt);
  elements.statusDot.className = `status-light ${payload.feedMode === "live" || payload.feedMode === "demo" ? "live" : ""}`;
  elements.totalEvents.textContent = summary.totalEvents || 0;
  elements.averageConfidence.textContent = `${summary.averageConfidence || 0}%`;
  elements.heroWinRate.textContent = `${summary.averageConfidence || 0}%`;
  elements.userCount.textContent = `${(3.2 + (summary.totalEvents || 0) / 100).toFixed(1)}K`;
}

function renderSportTabs() {
  const availableKeys = new Set(state.allEvents.map((event) => event.sportKey));
  const fixed = sportOptions.filter((item) => availableKeys.has(item.value) || state.allEvents.length === 0);
  elements.sportTabs.innerHTML = fixed
    .map(
      (item) => `
      <button type="button" class="${state.sportKey === item.value ? "active" : ""}" data-sport-key="${escapeHtml(item.value)}" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}">
        <img src="${escapeHtml(item.logo)}" alt="${escapeHtml(item.label)}" />
        <span class="visually-hidden">${escapeHtml(item.label)}</span>
      </button>`
    )
    .join("");

  elements.sportTabs.querySelectorAll("[data-sport-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sportKey = button.dataset.sportKey;
      elements.searchInput.value = "";
      applyCurrentFilters();
      if (!state.selectedId || !state.events.some((event) => event.id === state.selectedId)) {
        state.selectedId = state.events[0]?.id || null;
      }
      render();
    });
  });

  elements.quickTags.innerHTML = sportOptions
    .map(
      (item) => `
      <button type="button" data-sport-key="${escapeHtml(item.value)}" aria-label="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}">
        <img src="${escapeHtml(item.logo)}" alt="${escapeHtml(item.label)}" />
        <span class="visually-hidden">${escapeHtml(item.label)}</span>
      </button>`
    )
    .join("");
  elements.quickTags.querySelectorAll("[data-sport-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sportKey = button.dataset.sportKey;
      elements.searchInput.value = "";
      applyCurrentFilters();
      if (!state.selectedId || !state.events.some((event) => event.id === state.selectedId)) {
        state.selectedId = state.events[0]?.id || null;
      }
      render();
    });
  });
}

function renderMatchCard(event) {
  const pick = event.prediction.pick;
  const meters = probabilityRows(event);

  return `
    <article class="match-card ${state.selectedId === event.id ? "selected" : ""}" data-event-id="${escapeHtml(event.id)}">
      <div class="compact-score">
        <span class="compact-league">${escapeHtml(event.league)}</span>
        <div class="compact-team-row">
          <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.homeTeam))}" alt="" />
          <span>${escapeHtml(event.homeTeam)}</span>
          <strong>${escapeHtml(shortScoreValue(event, "home"))}</strong>
        </div>
        <div class="compact-team-row">
          <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.awayTeam))}" alt="" />
          <span>${escapeHtml(event.awayTeam)}</span>
          <strong>${escapeHtml(shortScoreValue(event, "away"))}</strong>
        </div>
        <div class="compact-status-row">
          ${eventTimeHtml(event)}
          <span>${escapeHtml(event.status === "live" ? scoreSubline(event, pick) : formatTime(event.commenceTime))}</span>
        </div>
      </div>
      <div class="compact-probability" aria-label="Probabilidades en tiempo real">
        <div class="compact-market-title">
          <span>Probabilidades IA</span>
          <strong>${escapeHtml(event.status === "live" ? liveClockText(event) : eventStatusLabel(event))}</strong>
        </div>
        ${meters
          .map(
            (meter) => `
          <div class="meter-row compact-meter-row ${meter.key === pick.key ? "active" : ""}">
            <div class="meter-head">
              <span>${escapeHtml(meter.label)}</span>
              <strong>${meter.percent}%</strong>
            </div>
            <div class="meter-track">
              <span class="meter-fill ${escapeHtml(meter.key)}" style="width: ${meter.percent}%"></span>
            </div>
          </div>`
          )
          .join("")}
        <button class="compact-more" type="button">Ver mas &gt;</button>
      </div>
    </article>
  `;
}

function attachLogoFallback(container) {
  container.querySelectorAll("img.team-logo").forEach((image) => {
    image.addEventListener("error", () => {
      image.src = "/assets/team-logos/team-default.png";
    }, { once: true });
  });
}

function selectEvent(eventId) {
  state.selectedId = eventId;
  renderAnalysis();
  document.querySelectorAll(".match-card, .featured-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.eventId === eventId);
  });
  elements.analysisCard?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openMatchDetail(eventId) {
  state.selectedId = eventId;
  renderAnalysis();
  showView("match");
  history.pushState(null, "", `#/partido/${encodeURIComponent(eventId)}`);
  renderMatchDetail();
}

function bindEventCards(container) {
  attachLogoFallback(container);
  container.querySelectorAll("[data-event-id]").forEach((card) => {
    card.addEventListener("click", () => {
      openMatchDetail(card.dataset.eventId);
    });
  });
}

function renderMatches() {
  const events = sortedEvents();
  const liveEvents = events.filter((event) => event.status === "live");
  const upcomingEvents = events.filter((event) => event.status !== "live");
  elements.liveMatches.innerHTML = liveEvents.length
    ? liveEvents.map(renderMatchCard).join("")
    : `<div class="empty-message">No hay partidos en vivo para este filtro.</div>`;
  elements.upcomingMatches.innerHTML = upcomingEvents.length
    ? upcomingEvents.map(renderMatchCard).join("")
    : `<div class="empty-message">No hay proximos partidos para este filtro.</div>`;

  bindEventCards(elements.liveMatches);
  bindEventCards(elements.upcomingMatches);
}

function platformCardsHtml() {
  const platforms = mexicanBooks;
  if (!platforms.some((platform) => platform.book === state.settings.bookmaker)) {
    state.settings.bookmaker = "best";
  }

  return platforms
    .map(
      (platform) => `
      <button class="platform-card ${state.settings.bookmaker === platform.book ? "active" : ""}" type="button" data-book="${escapeHtml(platform.book)}">
        <div class="platform-logo">${escapeHtml(platform.logo)}</div>
        <strong>${escapeHtml(platform.name)}</strong>
        <span>${escapeHtml(platform.subtitle)}</span>
      </button>`
    )
    .join("");
}

function bindPlatformCards(container) {
  if (!container) return;
  container.querySelectorAll("[data-book]").forEach((button) => {
    button.addEventListener("click", () => saveBookmaker(button.dataset.book));
  });
}

function renderPlatformGrid(container) {
  if (!container) return;
  container.innerHTML = platformCardsHtml();
  bindPlatformCards(container);
}

function renderPlatforms() {
  renderPlatformGrid(elements.platformGrid);
}

function featuredCardsHtml(events) {
  return events.length
    ? events
        .map((event) => {
          const pick = event.prediction.pick;
          return `
          <article class="featured-card" data-event-id="${escapeHtml(event.id)}">
            <div class="featured-head">
              <span class="featured-league">${escapeHtml(event.league)}</span>
              <span class="confidence-pill ${pick.confidence < 70 ? "medium" : ""}">${confidenceLabel(pick.confidence)}</span>
            </div>
            <div class="featured-teams">
              <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.homeTeam))}" alt="" />
              <span>vs</span>
              <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.awayTeam))}" alt="" />
            </div>
            <h3 class="featured-title">${escapeHtml(event.homeTeam)} vs ${escapeHtml(event.awayTeam)}</h3>
            <p class="featured-subtitle">${escapeHtml(pickSubtitle(event))}</p>
            <div class="featured-bottom">
              <div>
                <span class="featured-odd">${pick.bestOdds ? formatOdds(pick.bestOdds) : "--"}</span>
              </div>
              <button class="featured-button" type="button">Ver analisis</button>
            </div>
          </article>
        `;
        })
        .join("")
    : `<div class="empty-message">No hay picks destacados con esos filtros.</div>`;
}

function bindFeaturedCards(container) {
  if (!container) return;
  attachLogoFallback(container);
  container.querySelectorAll("[data-event-id]").forEach((card) => {
    card.addEventListener("click", () => {
      openMatchDetail(card.dataset.eventId);
    });
  });
}

function renderFeatured() {
  if (!elements.featuredPicks) return;
  elements.featuredPicks.innerHTML = featuredCardsHtml(strictEvents().slice(0, 4));
  bindFeaturedCards(elements.featuredPicks);
}

function renderDailyPredictions() {
  const picks = strictEvents()
    .filter((event) => event.prediction.pick.bestOdds)
    .slice(0, 3);
  elements.dailyPredictionList.innerHTML = picks.length
    ? picks
        .map((event) => {
          const pick = event.prediction.pick;
          return `
          <div class="odds-row">
            <span class="check-dot"><span aria-hidden="true">v</span></span>
            <div>
              <strong>${escapeHtml(event.homeTeam)} vs ${escapeHtml(event.awayTeam)}</strong>
              <span>${escapeHtml(pickSubtitle(event))}</span>
            </div>
            <em>${formatOdds(pick.bestOdds)}</em>
          </div>
        `;
        })
        .join("")
  : `<div class="empty-message">Busca mas eventos para ver predicciones del dia.</div>`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function derivedMarketOdds(event, index, confidenceOverride = null) {
  const confidence = confidenceOverride ?? event.prediction?.pick?.confidence ?? 60;
  const base = 1.5 + (100 - Math.min(confidence, 92)) / 170;
  const bump = deterministicRatio(`${event.id}-parlay-${index}`) * 0.18;
  return Math.min(2.15, Math.max(1.35, base + bump));
}

function confidenceForMarket(event, seed, base, swing = 7) {
  return Math.round(clamp(base + (deterministicRatio(`${event.id}-${seed}`) - 0.5) * swing, 56, 88));
}

function legOdds(event, index, confidence, preferredOdds = null) {
  return preferredOdds || derivedMarketOdds(event, index, confidence);
}

function withBookmakerLeg(event, leg, index) {
  const bookmaker = selectedBookmaker();
  if (bookmaker.book === "best") {
    return {
      ...leg,
      book: leg.bestBook || event.prediction?.pick?.bestBook || "Mejor disponible"
    };
  }

  return {
    ...leg,
    odds: adjustedBookOdds(leg.odds, bookmaker.book, `${leg.market}-${leg.selection}-${index}`, event.id),
    book: `${bookmaker.name} ref.`
  };
}

function parlayLegPool(event) {
  const pick = event.prediction.pick;
  const isMlb = event.sportKey === "baseball_mlb";
  const eventName = `${event.homeTeam} vs ${event.awayTeam}`;
  const baseConfidence = clamp(pick.confidence || 60, 56, 88);
  const pickSide = pick.label;
  const favoritePlus = `${pickSide} +1.5`;
  const pool = [
    {
      market: "Money Line",
      selection: `${pickSide} gana`,
      eventName,
      odds: legOdds(event, 0, baseConfidence, pick.bestOdds),
      confidence: Math.round(baseConfidence),
      bestBook: pick.bestBook || "Mejor disponible"
    }
  ];

  if (isMlb) {
    const lowRunGame = deterministicRatio(`${event.id}-mlb-runs`) < 0.52;
    const strikeoutLean = deterministicRatio(`${event.id}-mlb-k`) > 0.44;
    const mlbMarkets = [
      { market: "Run line", selection: favoritePlus, seed: "run-line", base: baseConfidence + 3 },
      { market: "Total de carreras", selection: lowRunGame ? "Menos de 9.5 carreras" : "Mas de 6.5 carreras", seed: "runs", base: baseConfidence - 2 },
      { market: "Carreras primeras 5 entradas", selection: lowRunGame ? "Menos de 5.5 carreras" : "Mas de 3.5 carreras", seed: "f5-runs", base: baseConfidence - 3 },
      { market: "Equipo anota 1+ carrera", selection: `${pickSide} anota 1+ carrera`, seed: "team-run", base: baseConfidence + 5 },
      { market: "Hits totales", selection: lowRunGame ? "Menos de 17.5 hits" : "Mas de 12.5 hits", seed: "hits", base: baseConfidence - 4 },
      { market: "Ponches totales", selection: strikeoutLean ? "Mas de 10.5 ponches" : "Menos de 15.5 ponches", seed: "strikeouts", base: baseConfidence - 4 },
      { market: "Primera mitad", selection: `${pickSide} +0.5 primeras 5 entradas`, seed: "f5-spread", base: baseConfidence - 1 },
      { market: "Carrera en primeras 2 entradas", selection: deterministicRatio(`${event.id}-early-run`) > 0.48 ? "Si hay carrera" : "No hay carrera", seed: "early-run", base: baseConfidence - 6 },
      { market: "Total de bases", selection: `${pickSide} mas de 10.5 bases`, seed: "bases", base: baseConfidence - 5 },
      { market: "Margen protegido", selection: `${pickSide} no pierde por 2+ carreras`, seed: "protected", base: baseConfidence + 2 }
    ];
    mlbMarkets.forEach((item, index) => {
      const confidence = confidenceForMarket(event, item.seed, item.base);
      pool.push({
        market: item.market,
        selection: item.selection,
        eventName,
        odds: legOdds(event, index + 1, confidence),
        confidence,
        bestBook: "Modelo IA"
      });
    });
    return pool;
  }

  const drawOutcome = event.prediction.outcomes.find((outcome) => outcome.key === "draw");
  const drawRisk = drawOutcome?.probability || 0;
  const lowGoalGame = deterministicRatio(`${event.id}-soccer-goals`) < 0.5;
  const soccerMarkets = [
    { market: "Doble oportunidad", selection: drawRisk > 0.2 ? `${pickSide} o empate` : `${pickSide} gana o empate`, seed: "double", base: baseConfidence + 5 },
    { market: "Goles totales", selection: lowGoalGame ? "Menos de 3.5 goles" : "Mas de 1.5 goles", seed: "goals", base: baseConfidence - 1 },
    { market: "Equipo marca", selection: `${pickSide} anota 1+ gol`, seed: "team-score", base: baseConfidence + 2 },
    { market: "Ambos equipos anotan", selection: pick.probability >= 0.58 ? "No" : "Si", seed: "btts", base: baseConfidence - 5 },
    { market: "Primer tiempo", selection: lowGoalGame ? "Menos de 1.5 goles 1T" : "Mas de 0.5 goles 1T", seed: "first-half", base: baseConfidence - 4 },
    { market: "Tiros de esquina", selection: deterministicRatio(`${event.id}-corners`) > 0.44 ? "Mas de 7.5 corners" : "Menos de 11.5 corners", seed: "corners", base: baseConfidence - 5 },
    { market: "Tarjetas totales", selection: deterministicRatio(`${event.id}-cards`) > 0.5 ? "Menos de 5.5 tarjetas" : "Mas de 2.5 tarjetas", seed: "cards", base: baseConfidence - 4 },
    { market: "Handicap protegido", selection: `${pickSide} +0.5`, seed: "handicap", base: baseConfidence + 4 },
    { market: "Total tiros al arco", selection: deterministicRatio(`${event.id}-shots`) > 0.48 ? "Mas de 6.5 tiros al arco" : "Menos de 10.5 tiros al arco", seed: "shots", base: baseConfidence - 6 },
    { market: "Resultado al descanso", selection: "Empate o favorito no pierde 1T", seed: "halftime-safe", base: baseConfidence - 2 }
  ];
  soccerMarkets.forEach((item, index) => {
    const confidence = confidenceForMarket(event, item.seed, item.base);
    pool.push({
      market: item.market,
      selection: item.selection,
      eventName,
      odds: legOdds(event, index + 1, confidence),
      confidence,
      bestBook: "Modelo IA"
    });
  });
  return pool;
}

function chooseParlayLegs(event, maxLegs = 5) {
  const pool = parlayLegPool(event)
    .sort((a, b) => {
      const confidenceDelta = b.confidence - a.confidence;
      if (confidenceDelta) return confidenceDelta;
      return deterministicRatio(`${event.id}-${a.market}`) - deterministicRatio(`${event.id}-${b.market}`);
    });
  const minimumConfidence = event.prediction?.pick?.strictSignal ? 74 : 70;
  const filteredPool = pool.filter((leg) => leg.confidence >= minimumConfidence);
  const candidatePool = filteredPool.length >= 3 ? filteredPool : pool.slice(0, 3);
  const highConfidence = candidatePool.filter((leg) => leg.confidence >= 76).length;
  const targetCount = Math.min(maxLegs, highConfidence >= 5 ? 5 : highConfidence >= 4 ? 4 : 3, candidatePool.length);
  return candidatePool
    .slice(0, targetCount)
    .sort((a, b) => b.confidence - a.confidence)
    .map((leg, index) => withBookmakerLeg(event, leg, index));
}

function parlayLegForEvent(event, index) {
  const legs = chooseParlayLegs(event, 5);
  return legs[index % legs.length];
}

function buildParlayTicket(sportKey, label) {
  const candidates = strictEvents()
    .filter((event) => event.sportKey === sportKey && event.prediction?.pick?.bestOdds)
    .slice(0, 6);
  if (!candidates.length) return null;

  const desiredCount = Math.min(5, Math.max(3, candidates.length));
  const primaryLegs = candidates.map((event) => chooseParlayLegs(event, 3)[0]).filter(Boolean);
  const extraLegs = candidates
    .flatMap((event) => chooseParlayLegs(event, 5).slice(1))
    .sort((a, b) => b.confidence - a.confidence);
  const legs = [];
  const seen = new Set();
  [...primaryLegs, ...extraLegs].forEach((leg) => {
    const key = `${leg.eventName}-${leg.market}-${leg.selection}`;
    if (legs.length < desiredCount && !seen.has(key)) {
      seen.add(key);
      legs.push(leg);
    }
  });
  const combined = legs.reduce((total, leg) => total * (leg.odds || 1), 1);
  const confidence = Math.round(legs.reduce((total, leg) => total + leg.confidence, 0) / legs.length);
  return { label, legs, combined, confidence, bookName: selectedBookmakerName() };
}

function buildSingleEventParlay(event) {
  if (!event?.prediction?.pick) return null;
  const legs = chooseParlayLegs(event, 5);
  const combined = legs.reduce((total, leg) => total * (leg.odds || 1), 1);
  const confidence = Math.round(legs.reduce((total, leg) => total + leg.confidence, 0) / legs.length);
  return {
    label: `${event.homeTeam} vs ${event.awayTeam}`,
    legs,
    combined,
    confidence,
    bookName: selectedBookmakerName()
  };
}

function renderParlayTicket(ticket, extraClass = "") {
  return `
    <article class="parlay-ticket ${escapeHtml(extraClass)}">
      <div class="parlay-head">
        <span class="source-badge">${escapeHtml(ticket.label)}</span>
        <strong>${ticket.legs.length} selecciones - ${ticket.confidence}% confianza IA - ${escapeHtml(ticket.bookName || selectedBookmakerName())}</strong>
      </div>
      ${ticket.legs
        .map(
          (leg) => `
        <div class="odds-row parlay-leg">
          <span class="check-dot"><span aria-hidden="true">v</span></span>
          <div>
            <strong>${escapeHtml(leg.market)} - ${escapeHtml(leg.selection)}</strong>
            <span>${escapeHtml(leg.eventName)} - ${escapeHtml(leg.book || ticket.bookName || selectedBookmakerName())}</span>
          </div>
          <em>${formatOdds(leg.odds)}</em>
        </div>`
        )
        .join("")}
      <div class="combo-note">
        <span>Momio combinado IA</span>
        <strong>${state.settings.oddsFormat === "american" ? formatOdds(ticket.combined) : `${ticket.combined.toFixed(2)}x`}</strong>
      </div>
      <p class="parlay-disclaimer">Parlay sugerido por probabilidad. No garantiza acierto ni ganancia.</p>
    </article>`;
}

function selectedEvent() {
  return state.allEvents.find((item) => item.id === state.selectedId) || state.events.find((item) => item.id === state.selectedId) || null;
}

function renderCombinations() {
  if (!elements.comboList) return;
  const tickets = [
    buildParlayTicket("soccer_fifa_world_cup", "Copa Mundial"),
    buildParlayTicket("baseball_mlb", "MLB")
  ].filter(Boolean);

  elements.comboList.innerHTML = tickets.length
    ? tickets
        .map((ticket) => renderParlayTicket(ticket))
        .join("")
    : `<div class="empty-message">Aun no hay suficientes partidos para generar el parlay del dia.</div>`;
  if (elements.parlayDailyCard) {
    elements.parlayDailyCard.hidden = true;
  }
}

function dailyParlayTickets() {
  return [
    buildParlayTicket("soccer_fifa_world_cup", "Copa Mundial"),
    buildParlayTicket("baseball_mlb", "MLB")
  ].filter(Boolean);
}

function renderDailyParlayPage() {
  if (!elements.dailyParlayContent) return;
  const tickets = dailyParlayTickets();
  elements.dailyParlayContent.innerHTML = `
    <div class="detail-actions">
      <button class="text-button detail-back" id="dailyParlayBackButton" type="button">Volver a inicio</button>
      <span class="source-badge">IA en vivo</span>
    </div>
    <section class="profile-hero daily-parlay-hero">
      <span class="ai-pill"><span class="live-dot"></span> Parlay del dia</span>
      <h1>Parlays generados por IA</h1>
      <p>Combinaciones ajustadas a ${escapeHtml(selectedBookmakerName())} con mercados como Money Line, goles/carreras totales, ambos anotan, corners, run line, hits y ponches.</p>
    </section>
    <article class="predictions-card single-parlay-card">
      <div class="predictions-header">
        <div class="predictions-icon"><span aria-hidden="true">P</span></div>
        <div>
          <h2>Parlay del dia</h2>
          <p>Actualizado con los eventos disponibles. No garantiza resultado.</p>
        </div>
      </div>
      <div class="predictions-list">
        ${
          tickets.length
            ? tickets.map((ticket) => renderParlayTicket(ticket, "daily-page-parlay")).join("")
            : `<div class="empty-message">Aun no hay suficientes partidos para generar el parlay del dia.</div>`
        }
      </div>
    </article>`;

  document.querySelector("#dailyParlayBackButton")?.addEventListener("click", () => showView("home"));
}

function actualOutcomeKey(event) {
  const finalStatuses = new Set(["final", "completed", "ended", "finished"]);
  if (!event?.score || !finalStatuses.has(String(event.status || "").toLowerCase())) return null;
  const home = Number(event.score.home);
  const away = Number(event.score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function isPredictionHit(event) {
  const actual = actualOutcomeKey(event);
  return actual && actual === event.prediction?.pick?.key && event.prediction?.pick?.confidence >= 72;
}

function resultLabel(event) {
  const actual = actualOutcomeKey(event);
  if (actual === "home") return event.homeTeam;
  if (actual === "away") return event.awayTeam;
  if (actual === "draw") return "Empate";
  return "Sin resultado";
}

function buildSettledParlayHits() {
  const groups = new Map();
  state.allEvents
    .filter(isPredictionHit)
    .forEach((event) => {
      const list = groups.get(event.sportKey) || [];
      list.push(event);
      groups.set(event.sportKey, list);
    });

  return Array.from(groups.entries())
    .map(([sportKey, events]) => {
      if (events.length < 3) return null;
      const sport = sportOptions.find((item) => item.value === sportKey);
      const legs = events.slice(0, 5).map((event, index) => ({
        market: "Prediccion cerrada",
        selection: `${event.prediction.pick.label} acerto`,
        eventName: `${event.homeTeam} vs ${event.awayTeam}`,
        odds: event.prediction.pick.bestOdds || derivedMarketOdds(event, index),
        confidence: event.prediction.pick.confidence,
        bestBook: event.prediction.pick.bestBook || "Mejor disponible"
      }))
      .map((leg, index) => withBookmakerLeg(events[index], leg, index));
      const combined = legs.reduce((total, leg) => total * (leg.odds || 1), 1);
      const confidence = Math.round(legs.reduce((total, leg) => total + leg.confidence, 0) / legs.length);
      return {
        label: `${sport?.label || "Parlay"} generado por IA ganador`,
        legs,
        combined,
        confidence,
        bookName: selectedBookmakerName()
      };
    })
    .filter(Boolean);
}

function renderHitsPage() {
  if (!elements.hitsPageContent) return;
  const hitEvents = state.allEvents.filter(isPredictionHit);
  const settledParlays = buildSettledParlayHits();
  elements.hitsPageContent.innerHTML = `
    <div class="detail-actions">
      <button class="text-button detail-back" id="hitsBackButton" type="button">Volver a inicio</button>
      <span class="source-badge">Marcadores finales</span>
    </div>
    <section class="profile-hero page-hero">
      <span class="ai-pill"><span class="live-dot"></span> Acertados de hoy</span>
      <h1>Picks y parlays cerrados</h1>
      <p>Solo aparecen cuando el marcador final confirma que la prediccion publicada coincidio con el resultado.</p>
    </section>
    <article class="predictions-card">
      <div class="predictions-header">
        <div class="predictions-icon"><span aria-hidden="true">A</span></div>
        <div>
          <h2>Equipos acertados</h2>
          <p>Resultados finales confirmados por la fuente deportiva.</p>
        </div>
      </div>
      <div class="featured-grid hits-grid">
        ${
          hitEvents.length
            ? hitEvents
                .map(
                  (event) => `
          <article class="featured-card hit-card" data-event-id="${escapeHtml(event.id)}">
            <div class="featured-head">
              <span class="featured-league">${escapeHtml(event.league)}</span>
              <span class="confidence-pill">Acertado</span>
            </div>
            <div class="featured-teams">
              <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.homeTeam))}" alt="" />
              <span>${escapeHtml(`${event.score.home} - ${event.score.away}`)}</span>
              <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.awayTeam))}" alt="" />
            </div>
            <h3 class="featured-title">${escapeHtml(resultLabel(event))}</h3>
            <p class="featured-subtitle">${escapeHtml(event.homeTeam)} vs ${escapeHtml(event.awayTeam)}</p>
          </article>`
                )
                .join("")
            : `<div class="empty-message">Todavia no hay picks cerrados como acertados hoy.</div>`
        }
      </div>
    </article>
    <article class="predictions-card">
      <div class="predictions-header">
        <div class="predictions-icon"><span aria-hidden="true">P</span></div>
        <div>
          <h2>Parlays acertados</h2>
          <p>Parlays de alta probabilidad generados por IA y confirmados con marcador final.</p>
        </div>
      </div>
      <div class="predictions-list">
        ${
          settledParlays.length
            ? settledParlays.map((ticket) => renderParlayTicket(ticket, "hit-parlay")).join("")
            : `<div class="empty-message">No hay parlays completamente cerrados como acertados todavia.</div>`
        }
      </div>
    </article>`;

  const hitsGrid = elements.hitsPageContent.querySelector(".hits-grid");
  bindFeaturedCards(hitsGrid);
  document.querySelector("#hitsBackButton")?.addEventListener("click", () => showView("home"));
}

function renderFeaturedPage() {
  if (!elements.featuredPageContent) return;
  const events = strictEvents().slice(0, 12);
  elements.featuredPageContent.innerHTML = `
    <div class="detail-actions">
      <button class="text-button detail-back" id="featuredBackButton" type="button">Volver a inicio</button>
      <span class="source-badge">${events.length} picks</span>
    </div>
    <section class="profile-hero page-hero">
      <span class="ai-pill"><span class="live-dot"></span> Picks destacados</span>
      <h1>Predicciones con mayor valor</h1>
      <p>Selecciona cualquier partido para abrir su analisis y su parlay generado para ese evento.</p>
    </section>
    <div class="featured-grid page-grid" id="featuredPageGrid">
      ${featuredCardsHtml(events)}
    </div>`;

  bindFeaturedCards(elements.featuredPageContent.querySelector("#featuredPageGrid"));
  document.querySelector("#featuredBackButton")?.addEventListener("click", () => showView("home"));
}

function renderSourcesPage() {
  if (!elements.sourcesPageContent) return;
  elements.sourcesPageContent.innerHTML = `
    <div class="detail-actions">
      <button class="text-button detail-back" id="sourcesBackButton" type="button">Volver a inicio</button>
      <span class="source-badge">Casas Mexico</span>
    </div>
    <section class="profile-hero page-hero">
      <span class="ai-pill"><span class="live-dot"></span> Fuentes de cuotas</span>
      <h1>Elige tu casa de apuestas</h1>
      <p>La app mostrara momios de referencia segun la fuente seleccionada: Draftea, Playdoit, Caliente.mx, Codere o Bet350.</p>
    </section>
    <div class="platform-grid page-grid" id="sourcesPageGrid"></div>`;

  renderPlatformGrid(elements.sourcesPageContent.querySelector("#sourcesPageGrid"));
  document.querySelector("#sourcesBackButton")?.addEventListener("click", () => showView("home"));
}

function aiTargetEvents(question) {
  const words = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
  const source = state.allEvents.length ? state.allEvents : state.events;
  const matches = words.length
    ? source.filter((event) => eventMatchesSearch(event, words.join(" ")))
    : [];
  const pool = matches.length ? matches : strictEvents();
  return [...pool]
    .sort((a, b) => {
      const liveDelta = Number(b.status === "live") - Number(a.status === "live");
      if (liveDelta) return liveDelta;
      return (b.prediction?.pick?.confidence || 0) - (a.prediction?.pick?.confidence || 0);
    })
    .slice(0, 3);
}

function buildAiAdvice(question, imageName) {
  const events = aiTargetEvents(question);
  if (!events.length) {
    return "No encontre partidos suficientes con esos datos. Prueba con el nombre de un equipo, liga o mercado.";
  }

  const lines = [];
  if (imageName) {
    lines.push(`Foto recibida: ${imageName}. La uso como referencia junto con los eventos disponibles.`);
  }
  lines.push("Lectura rapida de apoyo:");
  events.forEach((event, index) => {
    const pick = event.prediction.pick;
    const liveText = event.status === "live" ? ` en vivo ${liveClockText(event)}` : "";
    lines.push(
      `${index + 1}. ${event.homeTeam} vs ${event.awayTeam}${liveText}: ${pick.label}, ${pick.confidence}% confianza, momio ${formatOdds(pick.bestOdds)}.`
    );
  });
  lines.push("No lo tomes como garantia: si el momio baja mucho, si el marcador cambia o si te sientes presionado, mejor no entrar.");
  return lines.join("\n");
}

function renderAiMessage(message) {
  const text = escapeHtml(message.text).replace(/\n/g, "<br>");
  return `
    <div class="ai-message ${message.role === "user" ? "user" : "assistant"}">
      ${message.imageUrl ? `<img class="ai-chat-thumb" src="${escapeHtml(message.imageUrl)}" alt="Foto enviada" />` : ""}
      <p>${text}</p>
    </div>`;
}

function renderSearchAiPage() {
  if (!elements.searchAiContent) return;
  const suggestions = strictEvents().slice(0, 3);
  elements.searchAiContent.innerHTML = `
    <div class="detail-actions">
      <button class="text-button detail-back" id="searchBackButton" type="button">Volver a inicio</button>
      <span class="source-badge">IA de apoyo</span>
    </div>
    <section class="profile-hero page-hero">
      <span class="ai-pill"><span class="live-dot"></span> Busqueda IA</span>
      <h1>Consulta picks y fotos</h1>
      <p>Escribe una duda o adjunta una captura para recibir una lectura directa con los partidos disponibles.</p>
    </section>
    <article class="ai-chat-card">
      <div class="ai-chat-messages" id="aiChatMessages">
        ${
          state.aiMessages.length
            ? state.aiMessages.map(renderAiMessage).join("")
            : `
              <div class="ai-message assistant">
                <p>${escapeHtml(
                  suggestions.length
                    ? `Puedo revisar contigo ${suggestions.map((event) => `${event.homeTeam} vs ${event.awayTeam}`).join(", ")}.`
                    : "Puedo revisar contigo los partidos cuando carguen los datos."
                )}</p>
              </div>`
        }
      </div>
      <form class="ai-chat-form" id="aiChatForm">
        <label class="ai-photo-button">
          <input id="aiPhotoInput" type="file" accept="image/*" />
          <span class="nav-search-icon" aria-hidden="true"></span>
          Foto
        </label>
        <input id="aiQuestionInput" name="question" autocomplete="off" placeholder="Escribe equipo, partido o duda..." />
        <button type="submit">Enviar</button>
      </form>
      <p class="ai-photo-name" id="aiPhotoName"></p>
    </article>`;

  const photoInput = elements.searchAiContent.querySelector("#aiPhotoInput");
  const photoName = elements.searchAiContent.querySelector("#aiPhotoName");
  photoInput?.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    photoName.textContent = file ? `Foto lista: ${file.name}` : "";
  });

  elements.searchAiContent.querySelector("#aiChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const questionInput = elements.searchAiContent.querySelector("#aiQuestionInput");
    const question = questionInput.value.trim();
    const file = photoInput?.files?.[0] || null;
    if (!question && !file) return;
    const imageUrl = file ? URL.createObjectURL(file) : "";
    state.aiMessages.push({
      role: "user",
      text: question || "Analiza esta captura.",
      imageUrl
    });
    state.aiMessages.push({
      role: "assistant",
      text: buildAiAdvice(question, file?.name || "")
    });
    renderSearchAiPage();
  });

  document.querySelector("#searchBackButton")?.addEventListener("click", () => showView("home"));
}

function renderMatchDetail() {
  const detailView = document.querySelector("#matchDetailView");
  const detailContent = document.querySelector("#matchDetailContent");
  if (!detailView || !detailContent) return;

  const event = selectedEvent();
  if (!event) {
    detailContent.innerHTML = `
      <button class="text-button detail-back" id="matchBackButton" type="button">Volver</button>
      <div class="empty-message">Selecciona un partido para generar su parlay.</div>`;
    document.querySelector("#matchBackButton")?.addEventListener("click", () => showView("home"));
    return;
  }

  const pick = event.prediction.pick;
  const scoreText = event.score ? `${event.score.home} - ${event.score.away}` : "VS";
  const parlay = buildSingleEventParlay(event);
  detailContent.innerHTML = `
    <div class="detail-actions">
      <button class="text-button detail-back" id="matchBackButton" type="button">Volver a partidos</button>
      <span class="source-badge">${escapeHtml(event.league)}</span>
    </div>

    <article class="match-detail-card">
      <div class="match-top">
        <span>${escapeHtml(event.league)} - ${escapeHtml(eventStatusLabel(event))}</span>
        ${eventTimeHtml(event)}
      </div>
      <div class="detail-match-grid">
        <div class="team">
          <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.homeTeam))}" alt="" />
          <strong>${escapeHtml(event.homeTeam)}</strong>
        </div>
        <div class="score-box">
          <strong>${escapeHtml(scoreText)}</strong>
          <span>${escapeHtml(scoreSubline(event, pick))}</span>
          <small>Prediccion IA: ${escapeHtml(pick.label)}</small>
        </div>
        <div class="team">
          <img class="team-logo" src="${escapeHtml(teamLogoSrc(event.awayTeam))}" alt="" />
          <strong>${escapeHtml(event.awayTeam)}</strong>
        </div>
      </div>
      <div class="probability-meter">
        ${probabilityRows(event)
          .map(
            (meter) => `
          <div class="meter-row ${meter.key === pick.key ? "active" : ""}">
            <div class="meter-head">
              <span>${escapeHtml(meter.label)}</span>
              <strong>${meter.percent}%</strong>
            </div>
            <div class="meter-track"><span class="meter-fill ${escapeHtml(meter.key)}" style="width:${meter.percent}%"></span></div>
          </div>`
          )
          .join("")}
      </div>
    </article>

    <article class="predictions-card single-parlay-card">
      <div class="predictions-header">
        <div class="predictions-icon"><span aria-hidden="true">P</span></div>
        <div>
          <h2>Parlay de este partido</h2>
          <p>Generado solo para ${escapeHtml(event.homeTeam)} vs ${escapeHtml(event.awayTeam)}</p>
        </div>
      </div>
      ${parlay ? renderParlayTicket(parlay, "single-event-parlay") : `<div class="empty-message">No hay suficientes datos para este parlay.</div>`}
    </article>`;

  attachLogoFallback(detailContent);
  document.querySelector("#matchBackButton")?.addEventListener("click", () => showView("home"));
}

function renderAnalysis() {
  const event = state.events.find((item) => item.id === state.selectedId) || state.events[0];
  if (!event) {
    elements.analysisCard.innerHTML = `<div class="empty-message">Selecciona un evento para ver el analisis IA.</div>`;
    return;
  }

  const pick = event.prediction.pick;
  elements.analysisCard.innerHTML = `
    <h2>Analisis IA</h2>
    <p class="analysis-pick">${escapeHtml(pick.label)} - ${formatPercent(pick.probability)}</p>
    <p>${escapeHtml(event.league)} - ${escapeHtml(event.dataSource)} - ${escapeHtml(event.status === "live" ? liveClockText(event) : formatTime(event.commenceTime))}</p>
    <div class="analysis-grid">
      <div>
        <span>Confianza</span>
        <strong>${pick.confidence}%</strong>
      </div>
      <div>
        <span>Edge</span>
        <strong>${formatSignedPercent(pick.edge)}</strong>
      </div>
      <div>
        <span>Riesgo</span>
        <strong>${escapeHtml(pick.risk)}</strong>
      </div>
    </div>
    <ul class="reason-list">
      ${pick.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
    </ul>
  `;
}

function renderProfile() {
  const user = state.user || {};
  if (!elements.profileDetails) return;
  renderHeaderUser();
  if (
    elements.profileHandleInput &&
    !state.profileHandleDirty &&
    document.activeElement !== elements.profileHandleInput
  ) {
    elements.profileHandleInput.value = user.handle || user.username || "";
  }
  elements.profileDetails.innerHTML = `
    <div><span>Nombre completo</span><strong>${escapeHtml(`${user.firstNames || ""} ${user.lastNames || ""}`.trim() || "Sin nombre")}</strong></div>
    <div><span>Email</span><strong>${escapeHtml(user.email || "No registrado")}</strong></div>
    <div><span>Usuario</span><strong>${escapeHtml(user.handle || user.username || "Sin usuario")}</strong></div>
    <div><span>Contrasena</span><strong>${escapeHtml(user.password || "********")}</strong></div>
    <div><span>Telefono celular</span><strong>${escapeHtml(user.phone || "No registrado")}</strong></div>
  `;
}

function showView(view) {
  state.view = view;
  document.body.dataset.appView = view;
  if (view === "profile") {
    state.profileHandleDirty = false;
  }
  const homeView = document.querySelector("#homeView");
  const profileView = document.querySelector("#profileView");
  const matchDetailView = document.querySelector("#matchDetailView");
  const dailyParlayView = document.querySelector("#dailyParlayView");
  const hitsView = document.querySelector("#hitsView");
  const featuredView = document.querySelector("#featuredView");
  const sourcesView = document.querySelector("#sourcesView");
  const searchAiView = document.querySelector("#searchAiView");
  if (!homeView || !profileView || !matchDetailView || !dailyParlayView || !hitsView || !featuredView || !sourcesView || !searchAiView) return;

  homeView.hidden = view !== "home";
  profileView.hidden = view !== "profile";
  matchDetailView.hidden = view !== "match";
  dailyParlayView.hidden = view !== "parlay";
  hitsView.hidden = view !== "hits";
  featuredView.hidden = view !== "featured";
  sourcesView.hidden = view !== "sources";
  searchAiView.hidden = view !== "search";
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  elements.parlayShortcut?.classList.toggle("active", view === "parlay");
  elements.hitsShortcut?.classList.toggle("active", view === "hits");
  elements.featuredShortcut?.classList.toggle("active", view === "featured");
  elements.sourcesShortcut?.classList.toggle("active", view === "sources");
  if (view === "parlay") renderDailyParlayPage();
  if (view === "hits") renderHitsPage();
  if (view === "featured") renderFeaturedPage();
  if (view === "sources") renderSourcesPage();
  if (view === "search") renderSearchAiPage();
  if (view === "profile") renderProfile();
  const hashMap = {
    parlay: "#/parlay-del-dia",
    hits: "#/acertados-de-hoy",
    featured: "#/picks-destacados",
    sources: "#/fuentes-de-cuotas",
    search: "#/busqueda-ia"
  };
  if (hashMap[view] && location.hash !== hashMap[view]) {
    history.pushState(null, "", hashMap[view]);
  }
  if (view === "home" && location.hash) {
    history.pushState(null, "", location.pathname);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function routeFromHash() {
  const hash = decodeURIComponent(location.hash || "");
  if (hash === "#/parlay-del-dia") {
    showView("parlay");
    return;
  }
  if (hash === "#/acertados-de-hoy") {
    showView("hits");
    return;
  }
  if (hash === "#/picks-destacados") {
    showView("featured");
    return;
  }
  if (hash === "#/fuentes-de-cuotas") {
    showView("sources");
    return;
  }
  if (hash === "#/busqueda-ia") {
    showView("search");
    return;
  }
  if (hash.startsWith("#/partido/")) {
    const eventId = hash.replace("#/partido/", "");
    if (state.allEvents.some((event) => event.id === eventId)) {
      state.selectedId = eventId;
      showView("match");
      renderMatchDetail();
      return;
    }
  }
  showView("home");
}

async function saveSettings() {
  const payload = {
    oddsFormat: elements.oddsFormat.value,
    theme: "dark",
    bookmaker: state.settings.bookmaker || "best"
  };
  const response = await authFetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  state.settings = data.settings;
  state.user.settings = data.settings;
  document.body.dataset.theme = "dark";
  render();
}

async function saveProfile(event) {
  event.preventDefault();
  const handle = elements.profileHandleInput.value.trim();
  elements.profileMessage.dataset.type = "";
  elements.profileMessage.textContent = "Guardando...";
  const response = await authFetch("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle })
  });
  const data = await response.json();
  if (!response.ok) {
    elements.profileMessage.textContent = data.error || "No se pudo guardar el nombre de usuario.";
    elements.profileMessage.dataset.type = "error";
    return;
  }
  state.user = data.user;
  state.profileHandleDirty = false;
  elements.profileHandleInput.value = data.user.handle || handle;
  elements.profileMessage.textContent = `Nombre de usuario actualizado: ${data.user.handle || handle}`;
  elements.profileMessage.dataset.type = "ok";
  renderProfile();
}

async function saveBookmaker(bookmaker) {
  state.settings.bookmaker = bookmaker || "best";
  render();
  const response = await authFetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.settings)
  });
  const data = await response.json();
  if (response.ok && data.settings) {
    state.settings = data.settings;
    state.user.settings = data.settings;
    render();
  }
}

function render() {
  renderStatus();
  renderSportTabs();
  renderMatches();
  renderPlatforms();
  renderFeatured();
  renderDailyPredictions();
  renderCombinations();
  if (state.view === "parlay") renderDailyParlayPage();
  if (state.view === "hits") renderHitsPage();
  if (state.view === "featured") renderFeaturedPage();
  if (state.view === "sources") renderSourcesPage();
  if (state.view === "search") renderSearchAiPage();
  renderAnalysis();
  if (state.view === "match") renderMatchDetail();
  renderProfile();
}

function setupStream() {
  if (!window.EventSource) {
    setInterval(fetchEvents, 1000);
    return;
  }

  const stream = new EventSource("/api/stream");
  stream.addEventListener("snapshot", (event) => applyPayload(JSON.parse(event.data)));
  stream.addEventListener("error", () => {
    elements.feedMode.textContent = "Reconectando";
  });
}

function setupPullToRefresh() {
  const indicator = elements.pullRefresh;
  if (!indicator || !("ontouchstart" in window)) return;

  let startY = 0;
  let distance = 0;
  let pulling = false;
  let refreshing = false;
  const threshold = 78;

  const setIndicator = (nextDistance, mode = "") => {
    const visibleDistance = Math.min(nextDistance, 112);
    indicator.classList.toggle("visible", visibleDistance > 8 || Boolean(mode));
    indicator.classList.toggle("ready", visibleDistance >= threshold && !refreshing);
    indicator.classList.toggle("loading", mode === "loading");
    indicator.style.setProperty("--pull-distance", `${Math.max(0, visibleDistance)}px`);
    indicator.querySelector("strong").textContent =
      mode === "loading" ? "Actualizando" : visibleDistance >= threshold ? "Suelta para actualizar" : "Actualizar";
  };

  window.addEventListener(
    "touchstart",
    (event) => {
      if (refreshing || event.touches.length !== 1 || window.scrollY > 0) return;
      startY = event.touches[0].clientY;
      distance = 0;
      pulling = true;
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (!pulling || refreshing) return;
      const currentY = event.touches[0].clientY;
      distance = Math.max(0, currentY - startY);
      if (distance > 4 && window.scrollY <= 0) {
        event.preventDefault();
        setIndicator(distance);
      }
    },
    { passive: false }
  );

  window.addEventListener("touchend", async () => {
    if (!pulling || refreshing) return;
    pulling = false;
    if (distance < threshold) {
      setIndicator(0);
      return;
    }

    refreshing = true;
    setIndicator(threshold, "loading");
    try {
      await fetchEvents();
      indicator.querySelector("strong").textContent = "Actualizado";
      setTimeout(() => setIndicator(0), 500);
    } catch {
      indicator.querySelector("strong").textContent = "No se pudo actualizar";
      setTimeout(() => setIndicator(0), 900);
    } finally {
      setTimeout(() => {
        refreshing = false;
      }, 520);
    }
  });
}

function bindEvents() {
  let searchTimer = null;
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (elements.searchInput.value.trim()) state.sportKey = "all";
    fetchEvents();
  });
  elements.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (elements.searchInput.value.trim()) state.sportKey = "all";
      applyCurrentFilters();
      if (!state.selectedId || !state.events.some((event) => event.id === state.selectedId)) {
        state.selectedId = state.events[0]?.id || null;
      }
      render();
    }, 120);
  });
  elements.profileButton?.addEventListener("click", () => showView("profile"));
  elements.logoutButton?.addEventListener("click", async () => {
    await authFetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });
  elements.saveSettings.addEventListener("click", saveSettings);
  elements.parlayShortcut?.addEventListener("click", () => {
    showView("parlay");
  });
  elements.hitsShortcut?.addEventListener("click", () => {
    showView("hits");
  });
  elements.featuredShortcut?.addEventListener("click", () => {
    showView("featured");
  });
  elements.sourcesShortcut?.addEventListener("click", () => {
    showView("sources");
  });
  elements.profileForm?.addEventListener("submit", (event) => {
    saveProfile(event).catch((error) => {
      elements.profileMessage.textContent = error.message;
      elements.profileMessage.dataset.type = "error";
    });
  });
  elements.profileHandleInput?.addEventListener("input", () => {
    state.profileHandleDirty = true;
    if (elements.profileMessage) {
      elements.profileMessage.textContent = "";
      elements.profileMessage.dataset.type = "";
    }
  });
  elements.profileHandleInput?.addEventListener("blur", () => {
    if ((elements.profileHandleInput.value || "").trim() === (state.user?.handle || state.user?.username || "")) {
      state.profileHandleDirty = false;
    }
  });
  document.querySelectorAll("[data-action='show-all']").forEach((button) => {
    button.addEventListener("click", () => {
      showView("home");
      state.sportKey = "all";
      elements.searchInput.value = "";
      applyCurrentFilters();
      if (!state.selectedId || !state.events.some((event) => event.id === state.selectedId)) {
        state.selectedId = state.events[0]?.id || null;
      }
      render();
    });
  });
  document.querySelectorAll(".bottom-nav button[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.view);
    });
  });
  window.addEventListener("popstate", routeFromHash);
  setupPullToRefresh();
}

async function init() {
  try {
    await loadSession();
    bindEvents();
    setupStream();
    await fetchEvents();
    routeFromHash();
  } catch (error) {
    if (error.message !== "Sesion requerida") {
      elements.liveMatches.innerHTML = `<div class="empty-message">${escapeHtml(error.message)}</div>`;
    }
  }
}

init();
