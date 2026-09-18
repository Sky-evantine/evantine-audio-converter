import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="Evantine YouTube Downloader")

allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "https://converter.evantinetools.com").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}


def validate_youtube_url(value: str) -> str:
    try:
        parsed = urlparse(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid URL") from exc
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in YOUTUBE_HOSTS:
        raise HTTPException(status_code=400, detail="Only YouTube URLs are supported.")
    return value


def safe_filename(title: str, extension: str) -> str:
    cleaned = re.sub(r"[^\w\-. ]+", "", title, flags=re.UNICODE).strip() or "evantine-download"
    return f"{cleaned[:120]}.{extension}"


def remove_temp_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


@app.get("/health")
def health():
    return {"ok": True, "service": "evantine-youtube-downloader"}


@app.get("/api/youtube")
def youtube_download(
    url: str = Query(..., description="YouTube video URL"),
    format: str = Query("mp4", pattern="^(mp4|mp3)$"),
):
    url = validate_youtube_url(url)
    temp_dir = Path(tempfile.mkdtemp(prefix="evantine-yt-"))

    try:
        output_template = str(temp_dir / "%(title)s.%(ext)s")
        if format == "mp3":
            options = {
                "format": "bestaudio/best",
                "outtmpl": output_template,
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
            }
        else:
            options = {
                "format": "bestvideo*+bestaudio/best",
                "outtmpl": output_template,
                "merge_output_format": "mp4",
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
            }

        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
            title = info.get("title") or "evantine-download"

        candidates = [p for p in temp_dir.iterdir() if p.is_file()]
        if not candidates:
            raise HTTPException(status_code=502, detail="YouTube did not return a downloadable file.")

        target = max(candidates, key=lambda path: path.stat().st_mtime)
        extension = "mp3" if format == "mp3" else "mp4"
        filename = safe_filename(title, extension)
        media_type = "audio/mpeg" if format == "mp3" else "video/mp4"
        cleanup = BackgroundTask(remove_temp_dir, temp_dir)
        return FileResponse(target, media_type=media_type, filename=filename, background=cleanup)
    except yt_dlp.utils.DownloadError as exc:
        remove_temp_dir(temp_dir)
        message = str(exc).splitlines()[-1][:500]
        raise HTTPException(status_code=502, detail=f"YouTube download failed: {message}") from exc
    except HTTPException:
        remove_temp_dir(temp_dir)
        raise
    except Exception as exc:
        remove_temp_dir(temp_dir)
        raise HTTPException(status_code=500, detail=f"Downloader error: {str(exc)[:500]}") from exc
