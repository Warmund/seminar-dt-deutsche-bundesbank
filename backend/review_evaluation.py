"""Progress and evaluation use the same manual-routing rule as the review station."""

def progress(items, required):
    manual=[item for item in items if item['state']=='done' and required(item)]
    saved=sum(item.get('status')=='saved' for item in manual)
    unclassified=sum(item['state']!='done' for item in items)
    return {'total':len(items),'manual':len(manual),'saved':saved,'open':len(manual)-saved,'unclassified':unclassified,
            'completed':bool(items) and saved==len(manual) and unclassified==0}


def evaluate(items, required):
    manual=[item for item in items if required(item)]
    correct=lambda item,code:code==item['reference']
    ai=lambda item:(item['result'] or {}).get('prediction',{}).get('category')
    human_correct=sum(correct(item,item['final_code']) for item in manual)
    ai_correct=sum(correct(item,ai(item)) for item in manual)
    fixed=sum(not correct(item,ai(item)) and correct(item,item['final_code']) for item in manual)
    harmed=sum(correct(item,ai(item)) and not correct(item,item['final_code']) for item in manual)
    initial=[item for item in manual if item.get('initial_code')]
    classes=[]
    for code in sorted({item['reference'] for item in manual}):
        group=[item for item in manual if item['reference']==code]
        classes.append({'code':code,'n':len(group),'correct':sum(correct(item,item['final_code']) for item in group)})
    final=lambda item:item['final_code'] if required(item) else ai(item)
    return {'human_total':len(manual),'human_correct':human_correct,'human_wrong':len(manual)-human_correct,
            'ai_correct_same_cases':ai_correct,'fixed':fixed,'harmed':harmed,
            'both_correct':human_correct-fixed,'both_wrong':len(manual)-human_correct-harmed,
            'initial_total':len(initial),'initial_correct':sum(correct(item,item['initial_code']) for item in initial),
            'overall_total':len(items),'overall_correct':sum(correct(item,final(item)) for item in items),
            'ai_overall_correct':sum(correct(item,ai(item)) for item in items),'classes':classes,
            'confusion':[{'reference':item['reference'],'prediction':item['final_code']} for item in manual]}
