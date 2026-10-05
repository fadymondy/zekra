# zekra-ocr: PP-OCRv5 (any script) + ffmpeg keyframes + faster-whisper speech.
# GPU image; set OCR_DEVICE=cpu to run the same image without a GPU (slower).
FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    PADDLE_PDX_CACHE_HOME=/models/paddlex HF_HOME=/models/hf \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg libgl1 libglib2.0-0 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip3 install --no-cache-dir -U pip setuptools wheel
RUN pip3 install paddlepaddle-gpu==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
COPY requirements.txt .
RUN pip3 install -r requirements.txt
COPY app.py .

VOLUME /models
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s CMD curl -fs localhost:8000/health || exit 1
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--ws-max-size", "8388608"]
