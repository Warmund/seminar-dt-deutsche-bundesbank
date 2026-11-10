"""Private S3-compatible storage; only authenticated API routes issue download URLs."""
import hashlib
import os
from functools import lru_cache

import boto3
from botocore.config import Config


def configured():
    return all(os.environ.get(key) for key in ['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'MONETA_IMAGE_BUCKET'])


@lru_cache(maxsize=1)
def client():
    return boto3.client('s3', endpoint_url=os.environ['AWS_ENDPOINT_URL_S3'], region_name=os.environ['AWS_REGION'],
                        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                        config=Config(signature_version='s3v4', s3={'addressing_style': 'path'}, connect_timeout=10, read_timeout=30, retries={'max_attempts': 3, 'mode': 'standard'}))


def save_image(osm_type, osm_id, kind, body):
    digest = hashlib.sha256(body).hexdigest()
    # Immutable keys prevent concurrent uploads from overwriting a referenced image.
    key = f'moneta/{osm_type}_{osm_id}/{kind}/{digest}.png'
    client().put_object(Bucket=os.environ['MONETA_IMAGE_BUCKET'], Key=key, Body=body, ContentType='image/png')
    return key


def download_url(key):
    return client().generate_presigned_url('get_object', Params={'Bucket': os.environ['MONETA_IMAGE_BUCKET'], 'Key': key}, ExpiresIn=300)


def verify_image(key, expected):
    response = client().get_object(Bucket=os.environ['MONETA_IMAGE_BUCKET'], Key=key)
    stream = response['Body']
    try:
        actual = stream.read()
    finally:
        stream.close()
    if hashlib.sha256(actual).digest() != hashlib.sha256(expected).digest():
        raise ValueError('Prüfsumme im Object Storage stimmt nicht überein')
