import os
import uuid
from pathlib import Path
import psycopg
import pytest

@pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'),reason='TEST_DATABASE_URL fehlt')
def test_existing_data_survives_two_phase_dataset_migration():
    url=os.environ['TEST_DATABASE_URL'].replace('-pooler.','.')
    schema='dataset_migration_'+uuid.uuid4().hex
    with psycopg.connect(url,autocommit=True) as c:c.execute(f'CREATE SCHEMA {schema}')
    try:
        with psycopg.connect(url,options=f'-c search_path={schema}') as c:
            c.execute('''CREATE TABLE moneta_records(osm_type text,osm_id bigint,name text,PRIMARY KEY(osm_type,osm_id));
              CREATE TABLE moneta_images(osm_type text,osm_id bigint,kind text,content bytea,PRIMARY KEY(osm_type,osm_id,kind),FOREIGN KEY(osm_type,osm_id) REFERENCES moneta_records ON DELETE CASCADE);
              CREATE TABLE classification_runs(id uuid PRIMARY KEY);
              INSERT INTO moneta_records VALUES('way',1,'Original');
              INSERT INTO moneta_images VALUES('way',1,'osm','original');''')
            sql=Path(__file__).with_name('migrate_datasets.sql').read_text()
            first,second=sql.split('-- PHASE 2:',1)
            c.execute(first)
            # Old import conflict targets must still work until the new backend is deployed.
            c.execute("INSERT INTO moneta_records(osm_type,osm_id,name) VALUES('way',1,'Original') ON CONFLICT(osm_type,osm_id) DO UPDATE SET name=excluded.name")
            c.execute('-- PHASE 2:'+second)
            new_id=c.execute("INSERT INTO moneta_datasets(name) VALUES('Second') RETURNING id").fetchone()[0]
            c.execute("INSERT INTO moneta_records(dataset_id,osm_type,osm_id,name) VALUES(%s,'way',1,'Different')",(new_id,))
            assert c.execute('SELECT name FROM moneta_records ORDER BY dataset_id').fetchall()==[('Original',),('Different',)]
            assert c.execute('SELECT dataset_id,content FROM moneta_images').fetchone()==(1,b'original')
    finally:
        with psycopg.connect(url,autocommit=True) as c:c.execute(f'DROP SCHEMA {schema} CASCADE')
