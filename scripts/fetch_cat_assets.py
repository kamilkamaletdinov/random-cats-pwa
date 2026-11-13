from __future__ import annotations

import hashlib
import io
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "assets"
PHOTOS_DIR = ASSETS_DIR / "photos"
GIFS_DIR = ASSETS_DIR / "gifs"

PHOTO_COUNT = 40
GIF_COUNT = 24
USER_AGENT = "Mozilla/5.0 (compatible; RandomCatsPWA/1.0)"


def download(url: str, timeout: int = 30, accept: str = "image/*") -> bytes:
    last_error: Exception | None = None

    for attempt in range(4):
        try:
            request = Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": accept,
                },
            )
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except Exception as error:
            last_error = error
            if attempt < 3:
                time.sleep(attempt + 1)

    raise RuntimeError(f"Не удалось скачать {url}: {last_error}")


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def save_photo(
    data: bytes,
    output_dir: Path,
    index: int,
    source_id: str | None = None,
    source: str = "cataas",
) -> dict[str, str]:
    with Image.open(io.BytesIO(data)) as source_image:
        image = source_image.convert("RGB")
        image.thumbnail((900, 1100), Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=82, optimize=True, progressive=True)

    optimized = buffer.getvalue()
    filename = f"cat-photo-{index:02d}-{content_hash(optimized)}.jpg"
    (output_dir / filename).write_bytes(optimized)

    result = {
        "src": f"assets/photos/{filename}",
        "caption": "Просто прекрасный котик!",
        "source": source,
    }

    if source_id:
        result["sourceId"] = source_id

    return result


def build_optimized_gif(data: bytes, frame_step: int, colors: int) -> bytes:
    with Image.open(io.BytesIO(data)) as source:
        frames = []
        durations = []

        for frame_index, frame in enumerate(ImageSequence.Iterator(source)):
            if frame_index % frame_step:
                continue

            duration = frame.info.get("duration", source.info.get("duration", 100))
            paletted = frame.convert("RGB").quantize(
                colors=colors,
                method=Image.Quantize.MEDIANCUT,
            )
            paletted.info.clear()
            frames.append(paletted)
            durations.append(max(60, int(duration) * frame_step))

        if not frames:
            raise RuntimeError("GIF не содержит кадров")

        buffer = io.BytesIO()
        frames[0].save(
            buffer,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            optimize=True,
        )

    return buffer.getvalue()


def save_gif(data: bytes, output_dir: Path, index: int) -> dict[str, str]:
    optimized = build_optimized_gif(data, frame_step=2, colors=96)

    if len(optimized) > 1_500_000:
        optimized = build_optimized_gif(data, frame_step=3, colors=64)

    if len(optimized) > 2_000_000:
        optimized = build_optimized_gif(data, frame_step=4, colors=64)

    filename = f"cat-gif-{index:02d}-{content_hash(optimized)}.gif"
    (output_dir / filename).write_bytes(optimized)

    return {
        "src": f"assets/gifs/{filename}",
        "caption": "Анимированный котик!",
    }


def fetch_photos() -> list[dict[str, str]]:
    photos: list[dict[str, str]] = []
    seen_hashes: set[str] = set()
    candidates: list[dict[str, str]] = []

    try:
        for page in range(1, 7):
            response = download(
                "https://api.thecatapi.com/v1/images/search?limit=10&page="
                f"{page}&cache_bust={time.time_ns()}",
                accept="application/json",
            )
            for photo in json.loads(response):
                url = photo.get("url")
                if url:
                    candidates.append(
                        {
                            "url": url,
                            "id": str(photo.get("id") or ""),
                        }
                    )
    except Exception as error:
        print(f"The Cat API недоступен: {error}")

    attempts = 0
    candidate_index = 0
    while len(photos) < PHOTO_COUNT and attempts < PHOTO_COUNT * 4:
        attempts += 1
        source_id = None
        source = "cataas"

        if candidates and candidate_index < len(candidates):
            candidate = candidates[candidate_index]
            candidate_index += 1
            url = candidate["url"]
            source_id = candidate["id"] or None
            source = "thecatapi"
        else:
            url = f"https://cataas.com/cat?cache_bust={time.time_ns()}"

        try:
            data = download(url)
            digest = content_hash(data)
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)
            photos.append(
                save_photo(
                    data,
                    PHOTOS_DIR,
                    len(photos) + 1,
                    source_id=source_id,
                    source=source,
                )
            )
            print(f"Фото {len(photos)}/{PHOTO_COUNT}")
        except Exception as error:
            print(f"Фото пропущено: {error}")

    if not photos:
        raise RuntimeError("Не удалось скачать ни одной фотографии")

    return photos


def fetch_gifs() -> list[dict[str, str]]:
    gifs: list[dict[str, str]] = []
    seen_hashes: set[str] = set()
    attempts = 0

    while len(gifs) < GIF_COUNT and attempts < GIF_COUNT * 8:
        attempts += 1

        try:
            data = download(
                f"https://cataas.com/cat/gif?cache_bust={time.time_ns()}"
            )
            digest = content_hash(data)
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)
            gifs.append(save_gif(data, GIFS_DIR, len(gifs) + 1))
            print(f"GIF {len(gifs)}/{GIF_COUNT}")
        except Exception as error:
            print(f"GIF пропущено: {error}")

    if not gifs:
        raise RuntimeError("Не удалось скачать ни одного GIF")

    return gifs


def main() -> None:
    if ASSETS_DIR.exists():
        shutil.rmtree(ASSETS_DIR)

    PHOTOS_DIR.mkdir(parents=True)
    GIFS_DIR.mkdir(parents=True)

    photos = fetch_photos()
    gifs = fetch_gifs()

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "photos": photos,
        "gifs": gifs,
    }
    (ASSETS_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    total_size = sum(path.stat().st_size for path in ASSETS_DIR.rglob("*") if path.is_file())
    print(f"Готово: {len(photos)} фото, {len(gifs)} GIF, {total_size / 1024 / 1024:.1f} МБ")


if __name__ == "__main__":
    main()
