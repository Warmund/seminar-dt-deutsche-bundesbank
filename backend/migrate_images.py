"""Resume-safe migration of existing database images into the configured private bucket.

Run after deploying the storage-aware backend. Each verified image commits separately.
"""
import os

import psycopg
from psycopg.rows import dict_row

import image_storage


def migrate():
    if not image_storage.configured():
        raise RuntimeError('Object Storage muss zuerst eingerichtet werden')
    migrated = 0
    with psycopg.connect(os.environ['DATABASE_URL'], row_factory=dict_row) as connection:
        while True:
            # Lock one image at a time: concurrent uploads cannot change this row mid-migration.
            row = connection.execute('SELECT osm_type, osm_id, kind, content FROM public.moneta_images WHERE content IS NOT NULL ORDER BY osm_type, osm_id, kind LIMIT 1 FOR UPDATE').fetchone()
            if not row:
                break
            body = bytes(row['content'])
            key = image_storage.save_image(row['osm_type'], row['osm_id'], row['kind'], body)
            image_storage.verify_image(key, body)
            connection.execute('UPDATE public.moneta_images SET object_key=%s, content=NULL WHERE osm_type=%s AND osm_id=%s AND kind=%s', (key, row['osm_type'], row['osm_id'], row['kind']))
            connection.commit()
            migrated += 1
            print(f'{migrated} Bilder übertragen und geprüft', flush=True)
    return migrated


if __name__ == '__main__':
    migrate()
