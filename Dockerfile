FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/

# Runs as a non-root user, not the container default (root) — if this
# process is ever compromised (a dependency vuln, whatever), root
# inside the container is still a meaningfully bigger blast radius than
# an unprivileged one. Fixed UID/GID (not just `useradd` defaults) so
# it's predictable if you ever need to `chown` the bind-mounted ./data
# directory on the host to match (e.g. `chown -R 1000:1000 ./data` if
# you hit a permission error writing the SQLite file).
RUN groupadd -g 1000 app && useradd -u 1000 -g app -s /usr/sbin/nologin app \
    && mkdir -p /app/data \
    && chown -R app:app /app
USER app

VOLUME ["/app/data"]

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
