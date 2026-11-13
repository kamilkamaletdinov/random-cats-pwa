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

async function getRandomPhoto() {
  try {
    const response = await fetch(
      `${PHOTO_API_URL}?limit=20&cache_bust=${Date.now()}`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`The Cat API вернул ${response.status}`);
    }

    const photos = await response.json();
    if (!Array.isArray(photos) || photos.length === 0) {
      throw new Error("The Cat API не вернул фотографии");
    }

    const photo = photos[Math.floor(Math.random() * photos.length)];
    const breedNames = photo.breeds?.map((breed) => breed.name).filter(Boolean);

    return {
      url: photo.url,
      caption: breedNames?.length
        ? `Порода: ${breedNames.join(", ")}`
        : "Просто прекрасный котик!",
    };
  } catch {
    return {
      url: `${PHOTO_FALLBACK_URL}?cache_bust=${Date.now()}`,
      caption: "Просто прекрасный котик!",
    };
  }
}

function getRandomGif() {
  return {
    url: `${GIF_URL}?cache_bust=${Date.now()}`,
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
    const media = mode === "gif" ? getRandomGif() : await getRandomPhoto();

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
