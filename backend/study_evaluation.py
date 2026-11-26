"""Descriptive evaluation of the user study (small sample, no inferential statistics)."""
from statistics import mean, median

CODES = set('ABCDEFGHIJKLMNOPQRSTU')
TLX_SCALES = ('mental', 'physical', 'temporal', 'performance', 'effort', 'frustration')
CONFIDENCE_BINS = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.0001)]


def has_reference(row):
    return row.get('reference') in CODES


def decided(row):
    return row.get('final_code') in CODES


def outcome(row):
    """How the final decision relates to the LLM suggestion and the reference class."""
    if not has_reference(row) or not decided(row):
        return None
    ai, final, reference = row.get('ai_code'), row['final_code'], row['reference']
    if ai == reference:
        return 'confirmed' if final == reference else 'harmed'
    if final == reference:
        return 'detected'
    return 'adopted' if final == ai else 'other_wrong'


def describe(values):
    values = [value for value in values if value is not None]
    if not values:
        return {'n': 0, 'mean': None, 'median': None, 'min': None, 'max': None}
    return {'n': len(values), 'mean': mean(values), 'median': median(values), 'min': min(values), 'max': max(values)}


def certainty_normalized(value):
    """Si et al. (2024): map the 1-5 scale linearly onto 0-1."""
    return None if value is None else (value - 1) / 4


def group_summary(rows):
    scored = [row for row in rows if outcome(row)]
    correct = sum(row['final_code'] == row['reference'] for row in scored)
    return {
        'n': len(rows),
        'scored': len(scored),
        'human_correct': correct,
        'human_accuracy': correct / len(scored) if scored else None,
        'ai_correct': sum(row.get('ai_code') == row['reference'] for row in scored),
        'seconds': describe([row['active_ms'] / 1000 for row in rows if row.get('active_ms') is not None]),
        'chats': describe([row.get('chats', 0) for row in rows]),
        'with_chat': sum(row.get('chats', 0) > 0 for row in rows),
        'certainty': describe([row.get('certainty') for row in rows]),
        'certainty_normalized': describe([certainty_normalized(row.get('certainty')) for row in rows]),
    }


def evaluate(entries, questionnaires=()):
    entries = [row for row in entries if decided(row)]
    scored = [row for row in entries if outcome(row)]
    outcomes = {name: 0 for name in ('confirmed', 'harmed', 'detected', 'adopted', 'other_wrong')}
    for row in scored:
        outcomes[outcome(row)] += 1
    groups = {
        'all': entries,
        'ai_correct': [row for row in scored if row.get('ai_code') == row['reference']],
        'ai_wrong': [row for row in scored if row.get('ai_code') != row['reference']],
        'final_correct': [row for row in scored if row['final_code'] == row['reference']],
        'final_wrong': [row for row in scored if row['final_code'] != row['reference']],
        'confirmed': [row for row in entries if row.get('decision') == 'confirmed'],
        'corrected': [row for row in entries if row.get('decision') == 'corrected'],
    }
    bins = []
    for low, high in CONFIDENCE_BINS:
        rows = [row for row in entries if row.get('confidence') is not None and low <= row['confidence'] < high]
        bins.append({'label': f'{low:.1f}–{min(high, 1):.1f}', 'low': low, 'high': min(high, 1), **group_summary(rows)})
    missing = [row for row in entries if row.get('confidence') is None]
    if missing:
        bins.append({'label': 'ohne Konfidenz', 'low': None, 'high': None, **group_summary(missing)})
    cases = {}
    for row in entries:
        cases.setdefault(row['position'], []).append(row)
    per_case = []
    for position, rows in sorted(cases.items(), key=lambda pair: min(row.get('rank', 0) for row in pair[1])):
        first = rows[0]
        per_case.append({'position': position, 'name': first.get('name'), 'reference': first.get('reference'),
                         'ai_code': first.get('ai_code'), 'confidence': first.get('confidence'),
                         'adopted': sum(outcome(row) == 'adopted' for row in rows),
                         'detected': sum(outcome(row) == 'detected' for row in rows),
                         'harmed': sum(outcome(row) == 'harmed' for row in rows),
                         'decisions': sorted(row['final_code'] for row in rows), **group_summary(rows)})
    return {
        'sessions': len({row['session_id'] for row in entries}),
        'decisions': len(entries),
        'outcomes': outcomes,
        'groups': {name: group_summary(rows) for name, rows in groups.items()},
        'confidence_bins': bins,
        'per_case': per_case,
        'questionnaire': questionnaire_summary(questionnaires),
    }


def raw_tlx(tlx):
    """Raw NASA-TLX: unweighted mean of the six subscales (0-100, higher = more workload)."""
    return mean(tlx[scale] for scale in TLX_SCALES)


def questionnaire_summary(rows):
    rows = list(rows)
    return {
        'n': len(rows),
        'raw_tlx': describe([row['raw_tlx'] for row in rows]),
        'scales': {scale: describe([row['answers']['tlx'][scale] for row in rows]) for scale in TLX_SCALES},
        'usability': describe([row['usability'] for row in rows]),
        'usability_distribution': {str(value): sum(row['usability'] == value for row in rows) for value in range(1, 6)},
    }
