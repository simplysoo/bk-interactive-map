#!/usr/bin/env python3
"""Собирает локальные изображения для карт и справочников расширения."""

import argparse
import concurrent.futures
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "paladins"
INDEX = ROOT / "src" / "paladins-images.js"
REPORT = ROOT / "output" / "paladins-images-report.json"
MAX_BYTES = 12 * 1024 * 1024


def paladins_url(value, page="https://lib.paladins.ru/"):
    absolute = urllib.parse.urljoin(page, value.strip())
    parts = urllib.parse.urlsplit(absolute)
    host = parts.hostname or ""
    if parts.scheme not in {"http", "https"} or not (
        host == "paladins.ru" or host.endswith(".paladins.ru")
    ):
        return None
    path = urllib.parse.quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~")
    query = urllib.parse.quote(parts.query, safe="%:@!$&'()*+,;=/?-._~")
    return urllib.parse.urlunsplit(("https", host, path, query, ""))


class GuideImages(HTMLParser):
    def __init__(self, page):
        super().__init__()
        self.page = page
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        if tag != "img":
            return
        src = dict(attrs).get("src")
        if src and (url := paladins_url(src, self.page)):
            self.urls.add(url)


def get_bytes(url, attempts=3):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "BKInteractiveMap/0.1"})
            with urllib.request.urlopen(request, timeout=12) as response:
                data = response.read(MAX_BYTES + 1)
                if not data or len(data) > MAX_BYTES:
                    raise ValueError("Пустой файл или превышен лимит размера")
                return data
        except urllib.error.HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == attempts - 1:
                raise
            if error.code == 429:
                delay = error.headers.get("Retry-After", "")
                time.sleep(min(int(delay), 30) if delay.isdecimal() else 4)
                continue
        except (OSError, ValueError):
            if attempt == attempts - 1:
                raise
        time.sleep(1 + attempt)


def get_guide_images(url):
    parser = GuideImages(url)
    try:
        parser.feed(get_bytes(url).decode("utf-8", errors="replace"))
        parser.close()
        return url, parser.urls, None
    except (OSError, ValueError) as error:
        return url, set(), str(error)


def collect_map_images():
    urls = set()
    for path in sorted((ROOT / "data" / "maps").glob("*.json")):
        map_data = json.loads(path.read_text(encoding="utf-8"))
        for cell in map_data["cells"]:
            for entry in [cell, *cell.get("dropItems", [])]:
                image = entry.get("image")
                if image and (url := paladins_url(image, map_data["url"])):
                    urls.add(url)
    return urls


def image_extension(data):
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return None


def write_atomically(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def fetch_image(url):
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    for cached in ASSETS.glob(key + ".*"):
        extension = image_extension(cached.read_bytes())
        if extension and cached.suffix == extension:
            return url, cached.name, None

    failures = []
    sources = (
        url,
        "https://web.archive.org/web/2026id_/" + url,
    )
    for index, source in enumerate(sources):
        try:
            data = get_bytes(source, attempts=3 if index == 0 else 1)
            extension = image_extension(data)
            if not extension:
                raise ValueError("Полученные данные не являются поддерживаемым изображением")
            destination = ASSETS / (key + extension)
            write_atomically(destination, data)
            return url, destination.name, None
        except (OSError, ValueError) as error:
            failures.append(str(error))
    return url, None, " / ".join(failures)


def collect_guide_images():
    config = (ROOT / "src" / "dungeons.js").read_text(encoding="utf-8")
    guide_pages = sorted(set(re.findall(r"https://lib\.paladins\.ru/dungeons/[^'\" ]+/guide/[^'\" ]*", config)))
    guide_urls = set()
    missing_guides = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for url, images, error in pool.map(get_guide_images, guide_pages):
            guide_urls.update(images)
            if error:
                missing_guides[url] = error

    return guide_urls, len(guide_pages), missing_guides


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--guide-inventory", type=Path,
        help="JSON со списком urls, полученных из записей справочников расширения",
    )
    args = parser.parse_args()
    ASSETS.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    map_urls = collect_map_images()

    if args.guide_inventory:
        inventory = json.loads(args.guide_inventory.read_text(encoding="utf-8"))
        guide_urls = {url for value in inventory["urls"] if (url := paladins_url(value))}
        guide_page_count = len(inventory.get("stats", []))
        missing_guides = {}
    else:
        # Используем сохранённый список, чтобы повторная сборка не включала оформление сайта.
        guide_urls = set()
        guide_page_count = 0
        missing_guides = {}
        if INDEX.is_file():
            content = INDEX.read_text(encoding="utf-8")
            guide_urls = set(json.loads(content.split("=", 1)[1].strip().rstrip(";")))
        if not guide_urls:
            guide_urls, guide_page_count, missing_guides = collect_guide_images()

    urls = map_urls | guide_urls
    print(f"Карты: {len(map_urls)}, справочники: {len(guide_urls)}, всего: {len(urls)}.", flush=True)
    found = {}
    missing = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(fetch_image, url) for url in sorted(urls)]
        for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
            url, name, error = future.result()
            if name:
                found[url] = name
            else:
                missing[url] = error
            if completed % 100 == 0:
                print(f"Обработано {completed}/{len(urls)}, сохранено {len(found)}.", flush=True)

    contents = "window.BK_PALADINS_IMAGES = " + json.dumps(found, ensure_ascii=True, indent=2, sort_keys=True) + ";\n"
    write_atomically(INDEX, contents.encode("utf-8"))
    report = {
        "map_images": len(map_urls),
        "guide_images": len(guide_urls),
        "guide_pages": guide_page_count,
        "total": len(urls),
        "downloaded": len(found),
        "missing": missing,
        "missing_guides": missing_guides,
    }
    write_atomically(REPORT, (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(f"Сохранено {len(found)}/{len(urls)}; недоступно изображений: {len(missing)}, страниц: {len(missing_guides)}.", flush=True)
    return 1 if missing or missing_guides else 0


if __name__ == "__main__":
    raise SystemExit(main())
