"""Deterministic extractive text preparation; never adds model-generated facts."""
import json
import re
import textwrap

VERSION = 'jev-text-v1'
LIMIT = 6000
# shortcut: multilingual lexical cues, not semantic extraction; expand only after evaluating held-out texts.
ACTIVITY = re.compile(
    r'\b(manufactur\w*|produc\w*|develop\w*|speciali[sz]\w*|suppl\w*|provid\w*|'
    r'products?|services?|activities|industry|operates?|offers?|sells?|'
    r'herstell\w*|produzier\w*|fertig\w*|entwick\w*|spezialis\w*|'
    r'dienstleist\w*|leistungen|produkte|tätigkeit\w*|betreibt|bietet|verkauft|'
    r'fabric\w*|servicios|activité\w*|prestations|commercialis\w*)\b', re.I)
DESCRIPTION = re.compile(r'\b(is an?|ist ein\w*|est un\w*|es un\w*)\b', re.I)
COOKIE_NOTICE = re.compile(
    r'\b(this (website|site) uses cookies|we use cookies|wir verwenden cookies|'
    r'diese (website|webseite) verwendet cookies|cookie consent|consent preferences|'
    r'cookies? (are used|werden verwendet)|nous utilisons des cookies|utilizamos cookies)\b', re.I)
UI_ONLY = re.compile(
    r'(accept all|reject all|manage (cookies|consent)|cookie settings|privacy policy|'
    r'all rights reserved|alle akzeptieren|alle ablehnen|cookie[- ]einstellungen|'
    r'datenschutzerklärung|impressum|skip to (content|navigation)|'
    r'zum (inhalt|hauptinhalt)|menu|menü|home|kontakt|contact|login|sign in|'
    r'newsletter|search|suche|back to top|©[^\n]*)[.!]?$', re.I)
NAV_WORDS = set('home menu menü navigation search suche kontakt contact login logout anmelden '
                'startseite impressum datenschutz privacy policy cookies settings einstellungen '
                'accept reject all alle akzeptieren ablehnen newsletter sitemap'.split())
# These claim names are copied unchanged; they are prioritized only when the input is Wikidata JSON.
CLAIM_PRIORITY = {'industry', 'product or material produced', 'products', 'product', 'service',
                  'services', 'field of work', 'occupation', 'instance of', 'subclass of',
                  'main subject', 'business model'}


def _wikidata(text, limit):
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get('claims'), dict):
        return None
    result = {key: data[key] for key in ('label', 'description') if key in data}
    if len(json.dumps(result, ensure_ascii=False)) > limit:
        return text[:limit]
    result['claims'] = {}
    ordered = sorted(data['claims'], key=lambda key: key.casefold() not in CLAIM_PRIORITY)
    for key in ordered:
        result['claims'][key] = data['claims'][key]
        if len(json.dumps(result, ensure_ascii=False)) > limit:
            del result['claims'][key]
    return json.dumps(result, ensure_ascii=False)


def prepare_text(text, kind, limit=LIMIT):
    if kind == 'wikidata':
        structured = _wikidata(text, limit)
        if structured is not None:
            return structured
    normalized = re.sub(r'[^\S\n]+', ' ', text.replace('\r', '\n')).strip()
    units = []
    seen = set()
    for sentence in re.split(r'(?<=[.!?;])\s+|\n+', normalized):
        for unit in textwrap.wrap(sentence, width=500, break_long_words=False, break_on_hyphens=False):
            unit = unit.strip()
            signature = unit.casefold()
            words = set(re.findall(r'\w+', signature))
            if not unit or signature in seen or UI_ONLY.fullmatch(unit) or words and words <= NAV_WORDS:
                continue
            # Drop explicit consent notices, not mentions of cookies as a product.
            if COOKIE_NOTICE.search(unit) and not re.search(r'\b(manufactur\w*|produzier\w*|herstell\w*|baker\w*|biscuit\w*)\b', unit, re.I):
                continue
            seen.add(signature)
            units.append(unit)
    if not units:
        return ''
    def priority(index):
        unit = units[index]
        return min(3, len(ACTIVITY.findall(unit))) * 2 + bool(DESCRIPTION.search(unit)) + (index == 0)
    selected = []
    remaining = limit
    for index in sorted(range(len(units)), key=lambda index: (-priority(index), index)):
        unit = units[index]
        cost = len(unit) + bool(selected)
        if cost <= remaining:
            selected.append((index, unit))
            remaining -= cost
        elif not selected:
            selected.append((index, unit[:limit]))
            remaining = 0
    return '\n'.join(unit for _, unit in sorted(selected))
