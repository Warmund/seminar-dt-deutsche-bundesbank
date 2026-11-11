import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env")
from typing import Annotated, Any

import psycopg
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

app = FastAPI(title="WZ-Validierung")


def database():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL ist nicht konfiguriert")
    try:
        with psycopg.connect(url, row_factory=dict_row) as connection:
            connection.execute("SET LOCAL search_path TO public")
            yield connection
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail="Datenbank nicht erreichbar") from exc


Connection = Annotated[psycopg.Connection, Depends(database, scope="function")]
NonEmpty = Annotated[str, Field(min_length=1, max_length=500, pattern=r".*\S.*")]


class CaseIn(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    company_name: NonEmpty
    predicted_code: NonEmpty
    confidence: float | None = Field(default=None, ge=0, le=1)
    explanation: str | None = None
    source_data: dict[str, Any] = Field(default_factory=dict)


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewer: NonEmpty
    decision: NonEmpty


import auth  # noqa: E402


@app.get("/api/health")
def health(connection: Connection):
    connection.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/cases", dependencies=[Depends(auth.current_user)])
def list_cases(connection: Connection):
    return connection.execute("SELECT * FROM cases ORDER BY id").fetchall()


@app.post("/api/cases", status_code=201, dependencies=[Depends(auth.origin_check), Depends(auth.current_user)])
def create_case(case: CaseIn, connection: Connection):
    return connection.execute(
        "INSERT INTO cases (company_name, predicted_code, confidence, explanation, source_data) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING *",
        (case.company_name, case.predicted_code, case.confidence, case.explanation, Jsonb(case.source_data)),
    ).fetchone()


@app.get("/api/cases/{case_id}/decisions", dependencies=[Depends(auth.current_user)])
def list_decisions(case_id: int, connection: Connection):
    if not connection.execute("SELECT 1 FROM cases WHERE id = %s", (case_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Fall nicht gefunden")
    return connection.execute(
        "SELECT * FROM decisions WHERE case_id = %s ORDER BY id", (case_id,)
    ).fetchall()


@app.post("/api/cases/{case_id}/decisions", status_code=201, dependencies=[Depends(auth.origin_check), Depends(auth.current_user)])
def create_decision(case_id: int, decision: DecisionIn, connection: Connection):
    try:
        return connection.execute(
            "INSERT INTO decisions (case_id, reviewer, decision) VALUES (%s, %s, %s) RETURNING *",
            (case_id, decision.reviewer, decision.decision),
        ).fetchone()
    except psycopg.errors.ForeignKeyViolation as exc:
        raise HTTPException(status_code=404, detail="Fall nicht gefunden") from exc


import moneta_api  # noqa: E402

import classification_api  # noqa: E402
