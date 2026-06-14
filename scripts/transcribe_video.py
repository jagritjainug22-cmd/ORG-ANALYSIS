#!/usr/bin/env python3
"""
Transcribe a local video file (e.g. .mp4) to plain text.

Designed for long recordings (1+ hours). Uses ffmpeg to extract audio and
faster-whisper for efficient speech-to-text with optional GPU acceleration.

Setup:
    pip install -r scripts/requirements-transcribe.txt
    # ffmpeg must be on PATH: https://ffmpeg.org/download.html

Usage:
    python scripts/transcribe_video.py "C:\\path\\to\\video.mp4"
    python scripts/transcribe_video.py video.mp4 --model medium --srt
    python scripts/transcribe_video.py video.mp4 --output transcript.txt
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def _find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg

    if sys.platform == "win32":
        winget_root = (
            Path.home()
            / "AppData/Local/Microsoft/WinGet/Packages"
        )
        if winget_root.is_dir():
            matches = sorted(winget_root.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"))
            if matches:
                return str(matches[-1])
    return None


def _require_ffmpeg() -> str:
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        sys.exit(
            "ffmpeg not found on PATH.\n"
            "Install it from https://ffmpeg.org/download.html "
            "or: winget install Gyan.FFmpeg"
        )
    return ffmpeg


def _format_timestamp(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, rem = divmod(millis, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def extract_audio(video_path: Path, audio_path: Path, ffmpeg: str) -> None:
    """Extract mono 16 kHz WAV — optimal input for Whisper."""
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(audio_path),
    ]
    print(f"Extracting audio from {video_path.name} ...")
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        sys.exit(f"ffmpeg failed (exit {exc.returncode}). Is the file a valid video?")


def pick_device_and_compute(device: str) -> tuple[str, str]:
    if device != "auto":
        compute = "float16" if device == "cuda" else "int8"
        return device, compute

    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def transcribe(
    audio_path: Path,
    *,
    model_size: str,
    device: str,
    language: str | None,
    beam_size: int,
) -> tuple[list[dict], dict]:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit(
            "Missing dependency: faster-whisper\n"
            "Run: pip install -r scripts/requirements-transcribe.txt"
        )

    resolved_device, compute_type = pick_device_and_compute(device)
    print(
        f"Loading model '{model_size}' on {resolved_device} "
        f"(compute_type={compute_type}) ..."
    )
    model = WhisperModel(model_size, device=resolved_device, compute_type=compute_type)

    print("Transcribing (this may take a while for long videos) ...")
    started = time.time()

    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=beam_size,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=True,
    )

    segments: list[dict] = []
    last_report = started
    for segment in segments_iter:
        segments.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }
        )
        now = time.time()
        if now - last_report >= 30:
            mins = int(segment.end // 60)
            elapsed = int(now - started)
            print(f"  ... processed ~{mins} min of audio ({elapsed}s elapsed)")
            last_report = now

    elapsed = int(time.time() - started)
    print(
        f"Done. Detected language: {info.language} "
        f"(probability {info.language_probability:.2f}). "
        f"Transcription took {elapsed}s."
    )
    return segments, {"language": info.language, "duration": info.duration}


def write_txt(segments: list[dict], path: Path, include_timestamps: bool) -> None:
    lines: list[str] = []
    for seg in segments:
        if include_timestamps:
            lines.append(
                f"[{_format_timestamp(seg['start']).replace(',', '.')}] {seg['text']}"
            )
        else:
            lines.append(seg["text"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_srt(segments: list[dict], path: Path) -> None:
    blocks: list[str] = []
    for i, seg in enumerate(segments, start=1):
        blocks.append(
            "\n".join(
                [
                    str(i),
                    f"{_format_timestamp(seg['start'])} --> {_format_timestamp(seg['end'])}",
                    seg["text"],
                ]
            )
        )
    path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Transcribe a local video file to text using faster-whisper."
    )
    parser.add_argument("video", type=Path, help="Path to .mp4 (or other video) file")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output .txt path (default: same name as video with .txt)",
    )
    parser.add_argument(
        "--model",
        default="medium",
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
        help="Whisper model size (default: medium — good balance for long files)",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda"],
        help="Run on CPU or CUDA GPU (default: auto-detect)",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="Language code, e.g. en (default: auto-detect)",
    )
    parser.add_argument(
        "--beam-size",
        type=int,
        default=5,
        help="Beam search width (default: 5)",
    )
    parser.add_argument(
        "--timestamps",
        action="store_true",
        help="Include [HH:MM:SS.mmm] timestamps in the .txt output",
    )
    parser.add_argument(
        "--srt",
        action="store_true",
        help="Also write a .srt subtitle file",
    )
    parser.add_argument(
        "--keep-audio",
        action="store_true",
        help="Keep extracted .wav next to the video (default: delete temp file)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    video_path = args.video.expanduser().resolve()

    if not video_path.is_file():
        sys.exit(f"Video not found: {video_path}")

    ffmpeg = _require_ffmpeg()
    txt_path = (args.output or video_path.with_suffix(".txt")).resolve()
    srt_path = txt_path.with_suffix(".srt")

    if args.keep_audio:
        audio_path = video_path.with_suffix(".wav")
        cleanup_audio = False
    else:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        audio_path = Path(tmp.name)
        cleanup_audio = True

    try:
        extract_audio(video_path, audio_path, ffmpeg)
        segments, _meta = transcribe(
            audio_path,
            model_size=args.model,
            device=args.device,
            language=args.language,
            beam_size=args.beam_size,
        )

        if not segments:
            sys.exit("No speech detected in the audio track.")

        write_txt(segments, txt_path, include_timestamps=args.timestamps)
        print(f"Wrote transcript: {txt_path}")

        if args.srt:
            write_srt(segments, srt_path)
            print(f"Wrote subtitles:  {srt_path}")
    finally:
        if cleanup_audio and audio_path.exists():
            audio_path.unlink()


if __name__ == "__main__":
    main()
