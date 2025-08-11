FROM python:3.11-slim

# Audio libs for librosa/soundfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY api /app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
