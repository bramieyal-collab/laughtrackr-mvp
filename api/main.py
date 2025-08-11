from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os, uuid
import librosa, numpy as np

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.environ.get("DATA_DIR", "./data")
os.makedirs(DATA_DIR, exist_ok=True)

PROGRESS = {}  # fileId -> dict(status, progress, message)
RESULTS = {}   # fileId -> result json

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    # Some frameworks don't populate file.size; still enforced by server mem/disk
    if getattr(file, "size", None) and file.size > 500 * 1024 * 1024:
        return JSONResponse({"error": "File exceeds 500 MB."}, status_code=413)
    fid = uuid.uuid4().hex
    path = os.path.join(DATA_DIR, f"{fid}_{file.filename}")
    with open(path, 'wb') as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    PROGRESS[fid] = {"status": "processing", "progress": 0.0, "message": "Queued"}
    try:
        result = analyze_audio(path, progress_key=fid)
        RESULTS[fid] = result
        PROGRESS[fid] = {"status": "done", "progress": 1.0, "message": "Complete"}
    except Exception as e:
        PROGRESS[fid] = {"status": "error", "progress": 0.0, "message": str(e)}
    return {"fileId": fid}

@app.get("/api/status/{fid}")
def status(fid: str):
    return PROGRESS.get(fid, {"status": "unknown", "message": "No such job"})

@app.get("/api/result/{fid}")
def result(fid: str):
    r = RESULTS.get(fid)
    if not r:
        return JSONResponse({"error": "Not ready"}, status_code=404)
    return r

def analyze_audio(path: str, progress_key: str):
    y, sr = librosa.load(path, sr=16000, mono=True)
    duration = len(y) / sr

    hop = 512
    win = 1024
    rms = librosa.feature.rms(y=y, frame_length=win, hop_length=hop)[0]
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=win, hop_length=hop)[0]
    flat = librosa.feature.spectral_flatness(y=y, n_fft=win, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)

    r = (rms - rms.min()) / (rms.max() - rms.min() + 1e-9)
    f = (flat - flat.min()) / (flat.max() - flat.min() + 1e-9)

    score = 0.6*r + 0.3*f + 0.1*zcr
    thresh = float(np.median(score) + 1.2*np.std(score))
    mask = score > thresh

    segments = []
    start = None
    last_true = -1
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        if m:
            last_true = i
        if start is not None and (not m or i == len(mask)-1):
            end = last_true
            seg_start = float(times[start])
            seg_end = float(times[end])
            if seg_end - seg_start >= 0.3:
                segments.append([seg_start, seg_end])
            start = None

    merged = []
    for s in segments:
        if not merged:
            merged.append(s)
        else:
            if s[0] - merged[-1][1] < 0.4:
                merged[-1][1] = s[1]
            else:
                merged.append(s)

    segs = []
    total = max(len(merged), 1)
    for idx, (s, e) in enumerate(merged):
        i0 = int(librosa.time_to_frames(s, sr=sr, hop_length=hop))
        i1 = int(librosa.time_to_frames(e, sr=sr, hop_length=hop))
        local_rms = rms[i0:i1+1]
        peak_dbfs = 20*np.log10(max(local_rms.max(), 1e-9))
        min_dbfs = 20*np.log10(max(local_rms.min(), 1e-9))
        avg_r = float(np.mean(local_rms))

        segs.append({
            "startSec": float(s),
            "endSec": float(e),
            "durationSec": float(e - s),
            "peakDbfs": float(peak_dbfs),
            "minDbfs": float(min_dbfs),
            "avgRms": avg_r,
            "keywords": []
        })
        PROGRESS[progress_key] = {
            "status": "processing",
            "progress": (idx+1)/total,
            "message": f"Computing segment {idx+1}/{total}"
        }

    return {
        "fileId": progress_key,
        "filename": os.path.basename(path),
        "durationSec": float(duration),
        "segments": segs
    }
