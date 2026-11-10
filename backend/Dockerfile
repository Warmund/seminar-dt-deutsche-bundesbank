FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py moneta_api.py image_storage.py migrate_images.py auth.py create_user.py schema.sql .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
