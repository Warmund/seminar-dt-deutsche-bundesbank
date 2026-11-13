"""Queue messages contain only identifiers and expected persisted progress."""
from datetime import timedelta
from vercel.queue import DuplicateIdempotencyKeyError
from vercel.queue.sync import QueueClient

TOPIC = 'classification-run-v1'


def publish_step(run_id, user_id, generation, position, stage, retry=False, single=False, previous_attempt=None):
    payload = {'run_id':str(run_id), 'user_id':user_id, 'generation':str(generation),
               'position':position, 'stage':stage, 'retry':retry, 'single':single,
               'previous_attempt':str(previous_attempt) if previous_attempt else None}
    key = f'{generation}-{position}-{stage}'
    try:
        QueueClient().send(TOPIC, payload, idempotency_key=key, retention=timedelta(hours=24))
    except DuplicateIdempotencyKeyError:
        pass  # The successor was already published before a message was redelivered.
