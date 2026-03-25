import os
import shutil
import subprocess
import asyncio
import uuid
import gc
import time
from typing import Optional

import torch
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse  # noqa: F401 — used in route handlers

# -----------------------------
# App Setup
# -----------------------------

app = FastAPI(title="SeedVR2 Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Paths
# -----------------------------

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

INFERENCE_SCRIPT = os.path.join(
    BASE_DIR,
    "ComfyUI-SeedVR2_VideoUpscaler",
    "inference_cli.py"
)

MODEL_DIR = os.path.join(
    BASE_DIR,
    "ComfyUI-SeedVR2_VideoUpscaler",
    "models",
    "SEEDVR2"
)

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Serve output videos as static files
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")

# -----------------------------
# Available Models
# -----------------------------

AVAILABLE_MODELS = {
    "3b": "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
    "7b": "seedvr2_ema_7b_fp8_e4m3fn.safetensors",
}

def get_available_models():
    """Return only models whose .safetensors file actually exists in MODEL_DIR."""
    available = {}
    for key, filename in AVAILABLE_MODELS.items():
        if os.path.exists(os.path.join(MODEL_DIR, filename)):
            available[key] = filename
    return available

RESOLUTION_MAP = {
    "720p": 720,
    "1080p": 1080,
    "4k": 2160,
}

# -----------------------------
# Job Store
# -----------------------------

# jobs dict: { job_id: { status, percent, log, url, filename, created_at } }
jobs: dict = {}

# Lock to prevent concurrent GPU jobs
gpu_lock = asyncio.Lock()

# -----------------------------
# GPU Utilities
# -----------------------------

def clear_vram():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()

# -----------------------------
# Progress Parser
# -----------------------------

def parse_progress_from_line(line: str, total_chunks: Optional[int]) -> Optional[int]:
    """
    Parse inference_cli.py stdout lines for progress.
    The CLI prints lines like:
      "Chunk 1/5: 20 new + 2 context frames"
      "Streaming complete: 100 frames in 5 chunks"
    Returns an integer percent 0-95 if parsed, None otherwise.
    """
    import re
    # "Chunk N/M"
    m = re.search(r"Chunk\s+(\d+)/(\d+)", line)
    if m:
        current = int(m.group(1))
        total = int(m.group(2))
        if total > 0:
            # Map chunk progress to 20–90% range
            pct = 20 + int(70 * current / total)
            return min(pct, 90)
    # "Streaming complete"
    if "Streaming complete" in line or "Output saved to" in line:
        return 92
    return None

# -----------------------------
# Core Processing Function
# -----------------------------

async def run_upscale_job(
    job_id: str,
    input_path: str,
    output_path: str,
    resolution: int,
    model_filename: str,
    chunk_size: int,
):
    """Run the full upscale pipeline for a job. Updates jobs[job_id] throughout."""
    job = jobs[job_id]

    # --- Phase 1: Initializing ---
    job["status"] = "initializing"
    job["percent"] = 2
    job["log"] = "Clearing GPU memory…"
    clear_vram()

    # Build command
    cmd = [
        "python",
        INFERENCE_SCRIPT,
        input_path,
        "--output", output_path,
        "--resolution", str(resolution),
        "--batch_size", "1",
        "--chunk_size", str(chunk_size),
        "--temporal_overlap", "2",
        "--color_correction", "lab",
        "--model_dir", MODEL_DIR,
        "--dit_model", model_filename,
    ]

    job["log"] = f"Starting SeedVR2 ({model_filename}) at {resolution}p…"
    job["percent"] = 5
    job["status"] = "processing"

    # --- Phase 2: Run SeedVR2 ---
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    log_lines = []
    async for raw_line in process.stdout:
        line = raw_line.decode("utf-8", errors="replace").rstrip()
        if line:
            log_lines.append(line)
            # Keep last 20 lines for the log field
            job["log"] = "\n".join(log_lines[-20:])
            parsed = parse_progress_from_line(line, None)
            if parsed is not None:
                job["percent"] = parsed

    await process.wait()

    if process.returncode != 0:
        job["status"] = "error"
        job["log"] += "\n\n❌ SeedVR2 exited with error code " + str(process.returncode)
        # Clean up input
        if os.path.exists(input_path):
            os.remove(input_path)
        return

    # --- Phase 3: Re-encode for browser compatibility ---
    job["status"] = "encoding"
    job["percent"] = 93
    job["log"] = "Re-encoding video for browser playback…"

    fixed_output = output_path.replace(".mp4", "_fixed.mp4")
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-i", output_path,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        fixed_output,
    ]

    ff_proc = await asyncio.create_subprocess_exec(
        *ffmpeg_cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await ff_proc.wait()

    if os.path.exists(fixed_output):
        if os.path.exists(output_path):
            os.remove(output_path)
        os.rename(fixed_output, output_path)

    # --- Phase 4: Done ---
    base = os.path.basename(output_path)
    job["percent"] = 100
    job["status"] = "completed"
    job["log"] += "\n✅ Done!"
    job["filename"] = base
    job["url"] = f"http://127.0.0.1:8000/output/{base}"

    clear_vram()

    # Clean up uploaded input
    if os.path.exists(input_path):
        os.remove(input_path)

# -----------------------------
# Routes
# -----------------------------

@app.get("/")
def home():
    return {"message": "SeedVR2 backend running 🚀", "version": "2.0.0"}


@app.get("/models")
def list_models():
    """Return the models available on disk."""
    return {"models": get_available_models()}


@app.get("/status/{job_id}")
def get_status(job_id: str):
    """Return the current status of a specific job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/jobs")
def list_jobs():
    """Return all jobs (most recent first)."""
    sorted_jobs = sorted(
        [{"job_id": jid, **jdata} for jid, jdata in jobs.items()],
        key=lambda x: x.get("created_at", 0),
        reverse=True,
    )
    return {"jobs": sorted_jobs}


@app.post("/upscale")
async def upscale_video(
    file: UploadFile = File(...),
    resolution: str = Form("1080p"),
    model: str = Form("3b"),
    chunk_size: int = Form(20),
):
    # Validate model
    available = get_available_models()
    if model not in available:
        available_keys = list(available.keys())
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": f"Model '{model}' not available. Available: {available_keys}"},
        )

    # Validate resolution
    resolution_lower = resolution.lower()
    if resolution_lower not in RESOLUTION_MAP:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": f"Unknown resolution '{resolution}'. Use: {list(RESOLUTION_MAP.keys())}"},
        )
    resolution_px = RESOLUTION_MAP[resolution_lower]

    # Enforce single GPU job at a time
    if gpu_lock.locked():
        return JSONResponse(
            status_code=429,
            content={"status": "busy", "message": "A job is already running. Please wait for it to finish."},
        )

    # Create job
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "percent": 0,
        "log": "Job queued…",
        "url": None,
        "filename": None,
        "created_at": time.time(),
        "resolution": resolution,
        "model": model,
        "original_filename": file.filename,
    }

    # Save uploaded file
    unique_name = f"{job_id}_{file.filename}"
    input_path = os.path.join(UPLOAD_DIR, unique_name)
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    output_path = os.path.join(OUTPUT_DIR, f"upscaled_{unique_name}")

    # Run job in background (non-blocking)
    async def locked_job():
        async with gpu_lock:
            await run_upscale_job(
                job_id=job_id,
                input_path=input_path,
                output_path=output_path,
                resolution=resolution_px,
                model_filename=available[model],
                chunk_size=chunk_size,
            )

    asyncio.create_task(locked_job())

    return {"status": "queued", "job_id": job_id}