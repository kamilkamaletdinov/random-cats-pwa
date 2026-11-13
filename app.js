const LOCAL_MANIFEST_URL = "./assets/manifest.json";
const PHOTO_API_URL = "https://api.thecatapi.com/v1/images/search";
const PHOTO_FALLBACK_URL = "https://cataas.com/cat";
const GIF_URL = "https://cataas.com/cat/gif";

const image = document.querySelector("#cat-image");
const loading = document.querySelector("#loading");
const caption = document.querySelector("#caption");
const nextButton = document.querySelector("#next-button");
const nextButtonLabel = document.querySelector("#next-button-label");
const errorMessage = document.querySelector("#error-message");
const mediaPanel = document.querySelector("#media-panel");
const tabs = [...document.querySelectorAll(".tab")];

let activeMode = "photo";
let requestId = 0;
let manifestGeneratedAt = null;

const usedMedia = {
  photo: new Set(),
  gif: new Set(),
};

const initialMode =
  new URLSearchParams(window.location.search).get("mode") === "gif"
    ? "gif"
    : "photo";

function setLoading(isLoading) {
  loading.hidden = !isLoading;
  nextButton.disabled = isLoading;
  image.classList.remove("visible");
}

function preloadImage(source) {
  return new Promise((resolve, reject) => {
    const preloadedImage = new Image();
    preloadedImage.onload = () => resolve(source);
    preloadedImage.onerror = reject;
    preloadedImage.src = source;
  });
}

function getRandomItem(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("В коллекции нет изображений");
  }

  return items[Math.floor(Math.random() * items.length)];
}

function resolveMediaUrl(source) {
  return new URL(source, window.location.href).href;
}

function getMediaKey(mode, source) {
  return `${mode}:${resolveMediaUrl(source)}`;
}

function getUnusedItem(items, mode) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const unusedItems = items.filter((item) => {
    const source = item.src ?? item.url;
    return source && !usedMedia[mode].has(getMediaKey(mode, source));
  });

  return unusedItems.length > 0 ? getRandomItem(unusedItems) : null;
}

function markMediaUsed(mode, source) {
  usedMedia[mode].add(getMediaKey(mode, source));
}

async function getLocalManifest() {
  const response = await fetch(LOCAL_MANIFEST_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Локальный каталог вернул ${response.status}`);
  }

  const manifest = await response.json();

  if (manifest.generatedAt !== manifestGeneratedAt) {
    manifestGeneratedAt = manifest.generatedAt;
    usedMedia.photo.clear();
    usedMedia.gif.clear();
  }

  return manifest;
}

function getLocalMedia(items, mode) {
  const item = getUnusedItem(items, mode);
  if (!item) {
    return null;
  }

  const url = resolveMediaUrl(item.src);
  markMediaUsed(mode, url);

  return {
    url,
    caption: item.caption || "Просто прекрасный котик!",
  };
}

async function getExternalPhoto() {
  try {
    const response = await fetch(
      `${PHOTO_API_URL}?limit=10&cache_bust=${Date.now()}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`The Cat API вернул ${response.status}`);
    }

    const photos = await response.json();
    const photo = getUnusedItem(photos, "photo") ?? getRandomItem(photos);
    const breedNames = photo.breeds?.map((breed) => breed.name).filter(Boolean);
    markMediaUsed("photo", photo.url);

    return {
      url: photo.url,
      caption: breedNames?.length
        ? `Порода: ${breedNames.join(", ")}`
        : "Просто прекрасный котик!",
    };
  } catch {
    const url = `${PHOTO_FALLBACK_URL}?cache_bust=${Date.now()}`;
    markMediaUsed("photo", url);

    return {
      url,
      caption: "Просто прекрасный котик!",
    };
  }
}

async function getRandomPhoto() {
  try {
    const manifest = await getLocalManifest();
    const localPhoto = getLocalMedia(manifest.photos, "photo");

    if (localPhoto) {
      return localPhoto;
    }
  } catch {
    // Если локальный каталог недоступен, используем внешний источник.
  }

  return getExternalPhoto();
}

async function getRandomGif() {
  try {
    const manifest = await getLocalManifest();
    const localGif = getLocalMedia(manifest.gifs, "gif");

    if (localGif) {
      return localGif;
    }
  } catch {
    // Если локальный каталог недоступен, используем внешний источник.
  }

  const url = `${GIF_URL}?cache_bust=${Date.now()}`;
  markMediaUsed("gif", url);

  return {
    url,
    caption: "Анимированный котик!",
  };
}

async function showRandomMedia() {
  const currentRequestId = ++requestId;
  const mode = activeMode;

  setLoading(true);
  errorMessage.hidden = true;
  caption.textContent = "";

  try {
    const media = mode === "gif" ? await getRandomGif() : await getRandomPhoto();

    if (currentRequestId !== requestId) {
      return;
    }

    await preloadImage(media.url);

    if (currentRequestId !== requestId) {
      return;
    }

    image.src = media.url;
    image.alt = media.caption;
    image.classList.add("visible");
    caption.textContent = media.caption;
  } catch {
    if (currentRequestId !== requestId) {
      return;
    }

    errorMessage.textContent =
      "Не удалось загрузить котика. Проверьте подключение к интернету и попробуйте ещё раз.";
    errorMessage.hidden = false;
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
