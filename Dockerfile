FROM python:3.11-slim

# iputils-ping: the connectivity collector shells out to system `ping`
# rather than using a raw-socket library, specifically so it doesn't need
# root/NET_ADMIN inside the container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends iputils-ping \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
