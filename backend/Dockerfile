FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py classification_api.py classification_runs.py moneta_pipeline.py jev_api.py moneta_prompts.json LICENSE.moneta moneta_api.py image_storage.py migrate_images.py auth.py create_user.py schema.sql nace_sections.json .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
