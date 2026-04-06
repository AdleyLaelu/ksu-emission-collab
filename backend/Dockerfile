FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for scipy/numpy
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5003

CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--timeout", "120", "run:app"]
