"""Descriptive metrics of the user study."""
import pytest
from study_evaluation import certainty_normalized, evaluate, outcome, raw_tlx


def row(session, position, reference, ai, final, certainty=3, seconds=10, chats=0, confidence=0.5):
    return {'session_id': session, 'position': position, 'rank': position, 'name': f'F{position}', 'reference': reference, 'ai_code': ai,
            'final_code': final, 'decision': 'confirmed' if final == ai else 'corrected', 'certainty': certainty,
            'active_ms': seconds * 1000, 'chats': chats, 'confidence': confidence}


def test_outcomes_follow_llm_and_reference():
    assert outcome(row(1, 1, 'G', 'G', 'G')) == 'confirmed'
    assert outcome(row(1, 1, 'G', 'G', 'C')) == 'harmed'
    assert outcome(row(1, 1, 'C', 'G', 'C')) == 'detected'
    assert outcome(row(1, 1, 'C', 'G', 'G')) == 'adopted'
    assert outcome(row(1, 1, 'C', 'G', 'F')) == 'other_wrong'
    assert outcome(row(1, 1, '', 'G', 'G')) is None and outcome(row(1, 1, 'G', 'G', None)) is None


def test_evaluation_splits_time_chats_and_certainty():
    rows = [row(1, 1, 'C', 'G', 'C', 5, 40, 2, 0.35), row(1, 2, 'G', 'G', 'G', 4, 20, 0, 0.7),
            row(2, 1, 'C', 'G', 'G', 2, 10, 0, 0.35), row(2, 2, 'G', 'G', 'G', 5, 30, 1, 0.7), row(2, 3, 'A', 'A', None)]
    result = evaluate(rows, [{'raw_tlx': 40, 'usability': 4, 'answers': {'tlx': dict.fromkeys(['mental', 'physical', 'temporal', 'performance', 'effort', 'frustration'], 40)}}])
    assert result['decisions'] == 4 and result['sessions'] == 2
    assert result['groups']['ai_wrong']['human_accuracy'] == 0.5 and result['groups']['ai_wrong']['seconds']['mean'] == 25
    assert result['groups']['ai_correct']['chats']['mean'] == 0.5 and result['groups']['ai_wrong']['with_chat'] == 1
    assert result['groups']['final_wrong']['certainty_normalized']['mean'] == 0.25
    assert result['groups']['final_correct']['certainty_normalized']['mean'] == pytest.approx((1 + 0.75 + 1) / 3)
    bins = {b['label']: b for b in result['confidence_bins']}
    assert bins['0.2–0.4']['n'] == 2 and bins['0.6–0.8']['human_accuracy'] == 1
    assert [case['adopted'] for case in result['per_case']] == [1, 0]
    assert result['questionnaire']['usability_distribution']['4'] == 1


def test_questionnaire_scores():
    assert raw_tlx({'mental': 50, 'physical': 0, 'temporal': 50, 'performance': 100, 'effort': 50, 'frustration': 50}) == 50
    assert certainty_normalized(1) == 0 and certainty_normalized(5) == 1 and certainty_normalized(None) is None
