"""Deterministic extractive text preparation; never adds model-generated facts."""
import json
import re
import textwrap

VERSION = 'jev-text-v2'
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
def prepare_text(text, kind):
    if kind == 'wikidata':
        try:
            json.loads(text)
        except (ValueError, TypeError):
            pass
        else:
            return text.strip()
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
    return '\n'.join(units)
