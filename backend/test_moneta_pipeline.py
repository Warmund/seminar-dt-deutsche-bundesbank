from types import SimpleNamespace

import moneta_pipeline as pipeline
from classification_api import Prediction


def test_prompts_use_original_templates_and_extended_context():
    sources={'text':True,'osm':True,'satellite':True}
    simple,_ = pipeline.build_prompts('zero_shot','Simple',sources)
    extended,_ = pipeline.build_prompts('zero_shot','Extended',sources)
    multi,clues = pipeline.build_prompts('multi_turn','Extended',sources)
    assert simple.startswith(pipeline.ASSETS['zero_shot'].split('{NACE_CONTEXT}')[0].lstrip())
    assert 'Included:' not in simple and 'Included:' in extended
    assert 'Excludes' in extended or 'Excluded:' in extended
    assert multi.startswith(pipeline.ASSETS['multi_turn'].split('{NACE_CONTEXT}')[0].lstrip())
    assert set(clues)==set(pipeline.MODALITIES)
    assert '[retail]' in clues['website']


def test_zero_shot_is_one_call_and_does_not_send_reference_or_extra_tags(monkeypatch):
    seen=[]
    def call(connection,user,model,prompt,content,clue=False):
        seen.append(content)
        return SimpleNamespace(model='test',usage=None),Prediction(category='UNK',explanation='Missing evidence',evidence=[],uncertainty='Unknown')
    monkeypatch.setattr(pipeline,'model_call',call)
    item={'name':'Entity','reference':'SECRET_REFERENCE','snapshot':{'texts':{'website':'source text'},'images':{}},'clues':{}}
    run={'method':'zero_shot','model':'test','prompt':'prompt','sources':{'text':True,'osm':True,'satellite':True}}
    result,clues=pipeline.next_step(run,item,None,None)
    assert len(seen)==1 and 'SECRET_REFERENCE' not in str(seen)
    assert result['missing_sources']==['osm','satellite','wikidata','wikipedia']
    assert result['used_sources']==['website'] and clues=={}
    assert pipeline.source_texts({'tags':{'website':'https://example.org','wikidata':'Q123','wikipedia':'de:Something','shop':'do not use'}})=={}


def test_source_texts_preserves_long_sources_for_all_models():
    text = '\n'.join(f'Source passage {i} contains company information.' for i in range(500))
    assert len(text) > 6000
    for for_jev in (False, True):
        assert pipeline.source_texts({'sources': {'website': text}}, for_jev=for_jev)['website'] == text
