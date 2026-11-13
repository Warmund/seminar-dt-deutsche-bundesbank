from io import BytesIO

import pytest
import image_storage


def test_storage_upload_verification_and_signed_download(monkeypatch):
    objects = {}
    class Storage:
        def put_object(self, **kwargs):
            assert kwargs['ContentType'] == 'image/png'
            objects[kwargs['Key']] = kwargs['Body']
        def get_object(self, **kwargs):
            return {'Body': BytesIO(objects[kwargs['Key']])}
        def generate_presigned_url(self, operation, **kwargs):
            assert operation == 'get_object'
            assert kwargs['ExpiresIn'] == 300
            return 'https://storage.example/signed'
    monkeypatch.setenv('MONETA_IMAGE_BUCKET', 'private-images')
    monkeypatch.setattr(image_storage, 'client', lambda: Storage())
    key = image_storage.save_image('way', 123, 'satellite', b'image')
    image_storage.verify_image(key, b'image')
    assert image_storage.download_url(key).endswith('/signed')
    with pytest.raises(ValueError):
        image_storage.verify_image(key, b'corrupt')
    assert image_storage.save_image('way', 123, 'satellite', b'changed') != key


def test_migration_only_clears_database_bytes_after_verification(monkeypatch):
    import migrate_images
    monkeypatch.setenv('DATABASE_URL', 'test')
    monkeypatch.setattr(image_storage, 'configured', lambda: True)
    events = []
    class Connection:
        pending = True
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, args=None):
            if sql.startswith('UPDATE'):
                events.append('update')
                self.pending = False
            return self
        def fetchone(self):
            return {'dataset_id': 1, 'osm_type': 'way', 'osm_id': 1, 'kind': 'osm', 'content': b'png'} if self.pending else None
        def commit(self): events.append('commit')
    monkeypatch.setattr(migrate_images.psycopg, 'connect', lambda *a, **kw: Connection())
    monkeypatch.setattr(image_storage, 'save_image', lambda *a: 'image-key')
    monkeypatch.setattr(image_storage, 'verify_image', lambda *a: events.append('verify'))
    assert migrate_images.migrate() == 1
    assert events == ['verify', 'update', 'commit']
    events.clear()
    def fail(*args): raise ValueError('checksum mismatch')
    monkeypatch.setattr(image_storage, 'verify_image', fail)
    with pytest.raises(ValueError): migrate_images.migrate()
    assert events == []
