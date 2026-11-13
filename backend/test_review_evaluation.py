from review_evaluation import evaluate,progress

def row(reference,ai,human=None,status=None,state='done',manual=True):
    return {'reference':reference,'result':{'prediction':{'category':ai}},'final_code':human,'initial_code':None,'status':status,'state':state,'manual':manual}

def test_progress_excludes_deferred_and_unclassified_from_completion():
    items=[row('A','B','A','saved'),row('C','C',status='deferred')]
    assert progress(items,lambda item:item['manual'])['completed'] is False
    items[1].update(final_code='C',status='saved')
    assert progress(items,lambda item:item['manual'])['completed'] is True
    items.append(row('A','A',state='pending',manual=False))
    assert progress(items,lambda item:item['manual'])['unclassified']==1
    assert progress(items,lambda item:item['manual'])['completed'] is False

def test_human_and_pipeline_metrics_use_different_denominators():
    items=[row('A','B','A','saved'),row('C','C','A','saved'),row('D','B','C','saved'),row('E','E',manual=False)]
    result=evaluate(items,lambda item:item['manual'])
    assert result['human_total']==3 and result['human_correct']==1 and result['human_wrong']==2
    assert result['fixed']==1 and result['harmed']==1 and result['both_wrong']==1
    assert result['ai_correct_same_cases']==1
    assert result['overall_total']==4 and result['overall_correct']==2
    assert result['ai_overall_correct']==2
    assert result['initial_total']==0
