const CAT_API_URL = "https://api.thecatapi.com/v1/images/search";
const FALLBACK_URL = "https://cataas.com/cat";

const image = document.querySelector("#cat-image");
const loading = document.querySelector("#loading");
const caption = document.querySelector("#caption");
const nextButton = document.querySelector("#next-button");
const errorMessage = document.querySelector("#error-message");

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

async function getRandomCat() {
  const response = await fetch(
    `${CAT_API_URL}?limit=20&cache_bust=${Date.now()}`,
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
}

async function showRandomCat() {
  setLoading(true);
  errorMessage.hidden = true;
  caption.textContent = "";

  try {
    let cat;

    try {
      cat = await getRandomCat();
    } catch {
      cat = {
        url: `${FALLBACK_URL}?cache_bust=${Date.now()}`,
        caption: "Просто прекрасный котик!",
      };
    }

    await preloadImage(cat.url);
    image.src = cat.url;
    image.alt = cat.caption;
    image.classList.add("visible");
    caption.textContent = cat.caption;
  } catch {
    errorMessage.textContent =
      "Не удалось загрузить котика. Проверьте подключение к интернету и попробуйте ещё раз.";
    errorMessage.hidden = false;
  } finally {
    loading.hidden = true;
    nextButton.disabled = false;
  }
}

nextButton.addEventListener("click", showRandomCat);
showRandomCat();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Приложение продолжит работать, даже если service worker недоступен.
    });
  });
}
