import json

from source_text import prepare_text


def test_finds_activity_after_original_cutoff_and_removes_repeated_ui():
    text = 'Home\nMenu\nAccept all\nThis website uses cookies to improve your experience.\n'
    text += '\n'.join(f'Archive entry {i} describes an unrelated event from the past.' for i in range(200))
    activity = 'We manufacture medical equipment and supply hospitals across Europe.'
    text += '\n' + activity + '\n' + activity
    result = prepare_text(text,'website')
    assert text.index(activity)>6000
    assert activity in result and result.count(activity)==1
    assert len(result)<=6000
    assert 'This website uses cookies' not in result and 'Accept all' not in result


def test_preserves_product_cookies_and_unknown_language_content():
    text = 'We manufacture cookies and biscuits for bakeries.'
    assert prepare_text(text,'website')==text
    unknown = 'Leipomo valmistaa leipää ja leivonnaisia päivittäin.'
    assert prepare_text(unknown,'website')==unknown
    assert prepare_text('Accept all\nHome\nPrivacy policy','website')==''


def test_flattened_navigation_does_not_hide_later_business_description():
    text = ('Home Menu Contact Search Login ' * 400) + ' We produce industrial pumps and provide repair services.'
    result=prepare_text(text,'website')
    assert 'We produce industrial pumps' in ' '.join(result.split()) and len(result)<=6000


def test_wikidata_preserves_json_and_prioritizes_business_claims():
    claims={f'unrelated {i}':['x'*300] for i in range(30)}
    claims['industry']=['Manufacturing']
    claims['product or material produced']=['Medical equipment']
    result=prepare_text(json.dumps({'label':'Entity','claims':claims}),'wikidata')
    parsed=json.loads(result)
    assert parsed['label']=='Entity' and parsed['claims']['industry']==['Manufacturing']
    assert parsed['claims']['product or material produced']==['Medical equipment'] and len(result)<=6000


def test_selection_preserves_original_order_and_uses_only_source_fragments():
    text='Early history is described here. We manufacture pumps. A later sentence provides context.'
    result=prepare_text(text,'wikipedia')
    assert result.index('Early history')<result.index('We manufacture')<result.index('A later')
    assert all(fragment in text for fragment in result.splitlines())
