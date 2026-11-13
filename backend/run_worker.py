"""Durable one-step-per-message classifier; model calls are never blindly retried."""
import asyncio
import os
import uuid

import psycopg
from fastapi import HTTPException
from psycopg.rows import dict_row
from vercel.queue import RetryAfter, subscribe

import main  # registers routes before importing the shared step implementation
from classification_runs import process_item
from run_queue import TOPIC, publish_step


def process_message(message):
    run_id = uuid.UUID(message['run_id'])
    generation = uuid.UUID(message['generation'])
    user_id, position, expected = message['user_id'], message['position'], message['stage']
    with psycopg.connect(os.environ['DATABASE_URL'], row_factory=dict_row) as connection:
        run = connection.execute('SELECT user_id,runner_state,runner_generation FROM classification_runs WHERE id=%s FOR UPDATE', (run_id,)).fetchone()
        if not run or run['user_id'] != user_id or run['runner_state'] != 'running' or run['runner_generation'] != generation:
            return
        item = connection.execute("SELECT state, clues, attempt, started_at < now() - interval '5 minutes' AS stalled FROM classification_run_items WHERE run_id=%s AND position=%s", (run_id,position)).fetchone()
        if not item:
            return
        if item['state'] == 'running' and not (item['stalled'] and message['retry']):
            if not item['stalled']:
                raise RetryAfter(30)
            connection.execute("UPDATE classification_runs SET runner_state='interrupted' WHERE id=%s AND runner_generation=%s AND runner_state='running'", (run_id,generation))
            return
        stage = len(item['clues'] or {})
        if item['state'] != 'done' and stage == expected:
            previous_attempt = str(item['attempt']) if item['attempt'] else None
            if item['state'] == 'error' and (not message['retry'] or previous_attempt != message.get('previous_attempt')):
                connection.execute("UPDATE classification_runs SET runner_state='paused' WHERE id=%s AND runner_generation=%s AND runner_state='running'", (run_id,generation))
                return
            try:
                process_item(run_id, position, connection, {'id': user_id}, retry=message['retry'], generation=generation)
            except HTTPException as error:
                if error.status_code == 409:
                    raise RetryAfter(30) from None
                connection.execute("UPDATE classification_runs SET runner_state='paused' WHERE id=%s AND runner_generation=%s AND runner_state='running'", (run_id,generation))
                return
        # A redelivered message that already completed its step only schedules its successor.
        run = connection.execute('SELECT runner_state,runner_generation FROM classification_runs WHERE id=%s', (run_id,)).fetchone()
        if not run or run['runner_state'] != 'running' or run['runner_generation'] != generation:
            return
        next_item = None if message['single'] else connection.execute("SELECT position,clues,attempt FROM classification_run_items WHERE run_id=%s AND state='pending' ORDER BY position LIMIT 1", (run_id,)).fetchone()
        if not next_item:
            connection.execute("UPDATE classification_runs SET runner_state='paused' WHERE id=%s AND runner_generation=%s AND runner_state='running'", (run_id,generation))
            return
        connection.commit()
        publish_step(run_id,user_id,generation,next_item['position'],len(next_item['clues'] or {}),previous_attempt=next_item['attempt'])


@subscribe(topic=TOPIC, retry_after=30, max_attempts=30)
async def run_classification(message: dict[str, object]):
    await asyncio.to_thread(process_message, message)
