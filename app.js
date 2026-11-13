const LOCAL_MANIFEST_URL = "./assets/manifest.json";
const PHOTO_API_URL = "https://api.thecatapi.com/v1/images/search";
const PHOTO_FALLBACK_URL = "https://cataas.com/cat";
const GIF_URL = "https://cataas.com/cat/gif";

const HISTORY_KEY = "random-cats-history-v1";
const HISTORY_LIMIT = 1500;
const MANIFEST_TTL_MS = 5 * 60 * 1000;
const API_TIMEOUT_MS = 5000;
const GIF_TIMEOUT_MS = 12000;
const MEDIA_TIMEOUT_MS = 15000;

const image = document.querySelector("#cat-image");
const loading = document.querySelector("#loading");
const caption = document.querySelector("#caption");
const nextButton = document.querySelector("#next-button");
const nextButtonLabel = document.querySelector("#next-button-label");
const errorMessage = document.querySelector("#error-message");
const mediaPanel = document.querySelector("#media-panel");
const tabs = [...document.querySelectorAll(".tab")];

const seenMedia = {
  photo: new Set(),
  gif: new Set(),
};

let activeMode = "photo";
let requestId = 0;
let manifestCache = null;
let manifestCachedAt = 0;
let currentObjectUrl = null;

const initialMode =
  new URLSearchParams(window.location.search).get("mode") === "gif"
    ? "gif"
    : "photo";

loadSeenHistory();

function loadSeenHistory() {
  try {
    const savedHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");

    for (const mode of ["photo", "gif"]) {
      const values = Array.isArray(savedHistory[mode]) ? savedHistory[mode] : [];
      values.forEach((value) => seenMedia[mode].add(String(value)));
    }
  } catch {
    // Если история недоступна, приложение продолжит работать без неё.
  }
}

function saveSeenHistory() {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        photo: [...seenMedia.photo],
        gif: [...seenMedia.gif],
      }),
    );
  } catch {
    // В приватном режиме localStorage может быть недоступен.
  }
}

function isMediaSeen(mode, key) {
  return Boolean(key) && seenMedia[mode].has(key);
}

function markMediaUsed(mode, key) {
  if (!key || seenMedia[mode].has(key)) {
    return;
  }

  seenMedia[mode].add(key);

  while (seenMedia[mode].size > HISTORY_LIMIT) {
    const oldestKey = seenMedia[mode].values().next().value;
    seenMedia[mode].delete(oldestKey);
  }

  saveSeenHistory();
}

function setLoading(isLoading) {
  loading.hidden = !isLoading;
  nextButton.disabled = isLoading;
  image.classList.remove("visible");
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomPage() {
  return Math.floor(Math.random() * 20) + 1;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function preloadImage(source) {
  return new Promise((resolve, reject) => {
    const preloadedImage = new Image();
    const timeout = setTimeout(() => {
      preloadedImage.src = "";
      reject(new Error("Не удалось загрузить изображение вовремя"));
    }, MEDIA_TIMEOUT_MS);

    preloadedImage.onload = () => {
      clearTimeout(timeout);
      resolve(source);
    };
    preloadedImage.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Не удалось загрузить изображение"));
    };
    preloadedImage.src = source;
  });
}

async function hashBlob(blob) {
  if (!globalThis.crypto?.subtle) {
    return null;
  }

  try {
    const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function resolveMediaUrl(source) {
  return new URL(source, window.location.href).href;
}

async function getLocalManifest() {
  if (manifestCache && Date.now() - manifestCachedAt < MANIFEST_TTL_MS) {
    return manifestCache;
  }

  const response = await fetchWithTimeout(
    LOCAL_MANIFEST_URL,
    { cache: "no-store" },
    API_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Локальный каталог вернул ${response.status}`);
  }

  manifestCache = await response.json();
  manifestCachedAt = Date.now();
  return manifestCache;
}

function getLocalKey(item) {
  if (item.sourceId) {
    return `catapi:${item.sourceId}`;
  }

  const contentMatch = item.src.match(/-([a-f0-9]{12})\.(?:jpg|gif)$/i);
  if (contentMatch) {
    const type = item.src.includes("/gifs/") ? "gif" : "photo";
    return `local-${type}:${contentMatch[1]}`;
  }

  return `local:${item.src}`;
}

function getLocalMedia(
  items,
  mode,
  allowSeen = false,
  excludedKeys = new Set(),
) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const candidates = items
    .map((item) => ({ item, key: getLocalKey(item) }))
    .filter(
      ({ key }) =>
        !excludedKeys.has(key) && (allowSeen || !isMediaSeen(mode, key)),
    );

  if (candidates.length === 0) {
    return null;
  }

  const { item, key } = randomItem(candidates);

  return {
    url: resolveMediaUrl(item.src),
    key,
    caption: item.caption || "Просто прекрасный котик!",
    objectUrl: null,
  };
}

async function getDynamicPhoto() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetchWithTimeout(
      `${PHOTO_API_URL}?limit=10&page=${randomPage()}&cache_bust=${Date.now()}-${attempt}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      continue;
    }

    const photos = await response.json();
    if (!Array.isArray(photos) || photos.length === 0) {
      continue;
    }

    const unseenPhotos = photos.filter((photo) => {
      if (!photo.url || /\.gif(?:$|\?)/i.test(photo.url)) {
        return false;
      }

      const key = photo.id ? `catapi:${photo.id}` : `url:${photo.url}`;
      return !isMediaSeen("photo", key);
    });

    if (unseenPhotos.length === 0) {
      continue;
    }

    const photo = randomItem(unseenPhotos);
    const key = photo.id ? `catapi:${photo.id}` : `url:${photo.url}`;
    const breedNames = photo.breeds?.map((breed) => breed.name).filter(Boolean);

    return {
      url: photo.url,
      key,
      caption: breedNames?.length
        ? `Порода: ${breedNames.join(", ")}`
        : "Просто прекрасный котик!",
      objectUrl: null,
    };
  }

  throw new Error("Не найдено новых фотографий");
}

async function getDynamicCataasPhoto() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchWithTimeout(
      PHOTO_FALLBACK_URL,
      {
        cache: "no-store",
        headers: { Accept: "image/jpeg,image/*;q=0.8" },
      },
      API_TIMEOUT_MS,
    );

    if (!response.ok) {
      continue;
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.startsWith("image/")) {
      continue;
    }

    const blob = await response.blob();
    const hash = await hashBlob(blob);
    const key = hash ? `sha256:${hash}` : `cataas-photo:${Date.now()}`;

    if (isMediaSeen("photo", key)) {
      continue;
    }

    const objectUrl = URL.createObjectURL(blob);

    return {
      url: objectUrl,
      key,
      caption: "Просто прекрасный котик!",
      objectUrl,
    };
  }

  throw new Error("Не найдено новых фотографий");
}

async function getDynamicGif() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(
      GIF_URL,
      {
        cache: "no-store",
        headers: { Accept: "image/gif,image/*;q=0.8" },
      },
      GIF_TIMEOUT_MS,
    );

    if (!response.ok) {
      continue;
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.startsWith("image/gif")) {
      continue;
    }

    const blob = await response.blob();
    const hash = await hashBlob(blob);
    const key = hash ? `sha256:${hash}` : `cataas-gif:${Date.now()}`;

    if (isMediaSeen("gif", key)) {
      continue;
    }

    const objectUrl = URL.createObjectURL(blob);

    return {
      url: objectUrl,
      key,
      caption: "Анимированный котик!",
      objectUrl,
    };
  }

  throw new Error("Не найдено новых GIF");
}

async function* getPhotoCandidates() {
  const addedKeys = new Set();

  function canAdd(candidate) {
    if (!candidate || addedKeys.has(candidate.key)) {
      return false;
    }

    addedKeys.add(candidate.key);
    return true;
  }

  try {
    const dynamicPhoto = await getDynamicPhoto();
    if (canAdd(dynamicPhoto)) {
      yield dynamicPhoto;
    }
  } catch {
    // Локальная коллекция будет использована как резерв.
  }

  let manifest = null;
  try {
    manifest = await getLocalManifest();
    const localPhoto = getLocalMedia(manifest.photos, "photo");
    if (canAdd(localPhoto)) {
      yield localPhoto;
    }
  } catch {
    // Если локальный каталог недоступен, пробуем второй внешний источник.
  }

  try {
    const cataasPhoto = await getDynamicCataasPhoto();
    if (canAdd(cataasPhoto)) {
      yield cataasPhoto;
    }
  } catch {
    // Резервный внешний источник также может быть недоступен.
  }

  if (manifest) {
    const anyLocalPhoto = getLocalMedia(
      manifest.photos,
      "photo",
      true,
      addedKeys,
    );
    if (canAdd(anyLocalPhoto)) {
      yield anyLocalPhoto;
    }
  }
}

async function* getGifCandidates() {
  const addedKeys = new Set();

  function canAdd(candidate) {
    if (!candidate || addedKeys.has(candidate.key)) {
      return false;
    }

    addedKeys.add(candidate.key);
    return true;
  }

  try {
    const dynamicGif = await getDynamicGif();
    if (canAdd(dynamicGif)) {
      yield dynamicGif;
    }
  } catch {
    // Локальная коллекция будет использована как резерв.
  }

  try {
    const manifest = await getLocalManifest();
    const localGif = getLocalMedia(manifest.gifs, "gif");
    if (canAdd(localGif)) {
      yield localGif;
    }

    const anyLocalGif = getLocalMedia(
      manifest.gifs,
      "gif",
      true,
      addedKeys,
    );
    if (canAdd(anyLocalGif)) {
      yield anyLocalGif;
    }
  } catch {
    // Если локальный каталог недоступен, динамический источник уже был проверен.
  }
}

async function loadFirstWorkingCandidate(candidates) {
  for await (const candidate of candidates) {
    try {
      await preloadImage(candidate.url);
      return candidate;
    } catch {
      if (candidate.objectUrl) {
        URL.revokeObjectURL(candidate.objectUrl);
      }
    }
  }

  return null;
}

async function showRandomMedia() {
  const currentRequestId = ++requestId;
  const mode = activeMode;

  setLoading(true);
  errorMessage.hidden = true;
  caption.textContent = "";

  try {
    const candidates =
      mode === "gif" ? await getGifCandidates() : await getPhotoCandidates();

    if (currentRequestId !== requestId) {
      return;
    }

    const media = await loadFirstWorkingCandidate(candidates);

    if (!media) {
      throw new Error("Нет доступных изображений");
    }

    if (currentRequestId !== requestId) {
      if (media.objectUrl) {
        URL.revokeObjectURL(media.objectUrl);
      }
      return;
    }

    const previousObjectUrl = currentObjectUrl;
    image.src = media.url;
    image.alt = media.caption;
    image.classList.add("visible");
    caption.textContent = media.caption;
    currentObjectUrl = media.objectUrl;

    if (previousObjectUrl) {
      URL.revokeObjectURL(previousObjectUrl);
    }

    markMediaUsed(mode, media.key);
  } catch {
    if (currentRequestId === requestId) {
      errorMessage.textContent =
        "Не удалось загрузить котика. Проверьте подключение к интернету и попробуйте ещё раз.";
      errorMessage.hidden = false;
    }
  } finally {
    if (currentRequestId === requestId) {
      loading.hidden = true;
      nextButton.disabled = false;
    }
  }
}

function switchMode(mode, shouldFocus = false) {
  if (mode !== "photo" && mode !== "gif") {
    return;
  }

  activeMode = mode;

  for (const tab of tabs) {
    const isSelected = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;

    if (isSelected && shouldFocus) {
      tab.focus();
    }
  }

  mediaPanel.setAttribute("aria-labelledby", `${mode}-tab`);
  nextButtonLabel.textContent = mode === "gif" ? "Ещё GIF" : "Ещё фото";

  const pageUrl = new URL(window.location.href);
  if (mode === "gif") {
    pageUrl.searchParams.set("mode", "gif");
  } else {
    pageUrl.searchParams.delete("mode");
  }
  window.history.replaceState(null, "", pageUrl);

  showRandomMedia();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    if (tab.dataset.mode !== activeMode) {
      switchMode(tab.dataset.mode);
    }
  });
}

document.querySelector(".tabs").addEventListener("keydown", (event) => {
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex === -1) {
    return;
  }

  let nextIndex;

  switch (event.key) {
    case "ArrowLeft":
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case "ArrowRight":
      nextIndex = (currentIndex + 1) % tabs.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  switchMode(tabs[nextIndex].dataset.mode, true);
});

nextButton.addEventListener("click", showRandomMedia);
switchMode(initialMode);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Приложение продолжит работать, даже если service worker недоступен.
    });
  });
}
