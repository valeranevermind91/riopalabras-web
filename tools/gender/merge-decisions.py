"""Merge the owner's decisions (the "Решение" column of ~/Desktop/gender-review.xlsx) into noun_gender.json.

    python3 tools/gender/merge-decisions.py --dry                  report what would change, write nothing
    python3 tools/gender/merge-decisions.py                        write out/noun_gender.json (the old one is kept as noun_gender.before-merge-<time>.json)
    options: --sheet PATH (default ~/Desktop/gender-review.xlsx), --out-dir DIR (default tools/gender/out)

The result is always rebuilt from the settled (AGREE) nouns of decide.mjs (out/noun_gender.full.json) plus the decisions, so running it twice gives the same file.
Decision values (case does not matter):
    OK            take the proposed display (a row whose proposal is empty "—", or is not one article + the headword, is skipped with a warning)
    el / la       set "el X" / "la X" (X = the headword as the card shows it); on a plural-only row: "los X" / "las X"
    el/la         set "el/la X" (not allowed on a plural-only row)
    без артикля   no entry (the noun is recorded in noun_gender.excluded.json)
    (empty)       not decided yet: no entry
Rows are matched to the review set by their word and example text, not by position, so the sheet may be sorted or filtered.
"""
import argparse
import json
import os
import re
import shutil
import sys
import unicodedata
from datetime import datetime, timezone

from openpyxl import load_workbook

here = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--sheet', default=os.path.expanduser('~/Desktop/gender-review.xlsx'))
ap.add_argument('--out-dir', default=os.path.join(here, 'out'))
ap.add_argument('--dry', action='store_true')
args = ap.parse_args()
out = args.out_dir

DISPLAY = re.compile(r'^(el/la|el|la|los|las) (\S.*)$')
ARTICLE_G = {'el': 'm', 'la': 'f', 'el/la': 'mf', 'los': 'pl-m', 'las': 'pl-f'}


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.combining(c)).lower().strip()


def load(name):
    with open(os.path.join(out, name), encoding='utf-8') as f:
        return json.load(f)


full = load('noun_gender.full.json')
review_rows = load('review-rows.json')
current = load('noun_gender.json')
by_text = {}
for r in review_rows:
    by_text.setdefault((r['word'].strip(), (r['example'] or '').strip()), []).append(r)

# ---- the sheet
ws = load_workbook(args.sheet, data_only=True).active
header = [str(c.value or '').strip() for c in ws[1]]
need = {'word': 'Word (as displayed)', 'example': 'Example', 'proposed': 'Proposed display', 'decision': 'Решение'}
missing = [h for h in need.values() if h not in header]
if missing:
    sys.exit(f'the sheet has no column {missing}; found {header}')
col = {k: header.index(v) for k, v in need.items()}

CANON = {'ok': 'OK', 'el': 'el', 'la': 'la', 'el/la': 'el/la', 'без артикля': 'без артикля'}
decided, problems, undecided, seen = {}, [], 0, set()
counts = {'OK': 0, 'el': 0, 'la': 0, 'el/la': 0, 'без артикля': 0}
for n, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    if not any(row):
        continue
    word, example = str(row[col['word']] or '').strip(), str(row[col['example']] or '').strip()
    raw = row[col['decision']]
    value = str(raw).strip() if raw is not None else ''
    meta = by_text.get((word, example))
    if meta is None:
        if value:
            problems.append(f'row {n} ({word}): not in the current review set (the sheet is from another run?); decision "{value}" ignored')
        continue
    if len(meta) > 1:
        problems.append(f'row {n} ({word}): two review rows have this word and example; skipped')
        continue
    meta = meta[0]
    seen.add(meta['key'])
    if value == '':
        undecided += 1
        continue
    d = CANON.get(value.lower().replace(' ', ' '))
    if d is None:
        problems.append(f'row {n} ({word}): "{value}" is not one of OK / el / la / el/la / без артикля; skipped')
        continue
    counts[d] += 1
    head, key = meta['head'], meta['key']
    if d == 'без артикля':
        decided[key] = ('none', None, None, word)
        continue
    if d == 'OK':
        proposed = str(row[col['proposed']] or '').strip()
        m = DISPLAY.match(proposed)
        if proposed in ('', '—') or not m:
            problems.append(f'row {n} ({word}): OK, but the proposal "{proposed}" is not one article + the word: skipped (choose el / la / el/la / без артикля)')
            continue
        if fold(m.group(2)) != fold(head):
            problems.append(f'row {n} ({word}): OK, but the proposal "{proposed}" is not the card\'s headword "{head}": skipped')
            continue
        decided[key] = ('set', proposed, ARTICLE_G[m.group(1)], word)
        continue
    # el / la / el/la
    if meta.get('plural'):
        if d == 'el/la':
            problems.append(f'row {n} ({word}): el/la on a plural-only noun: skipped')
            continue
        art = 'los' if d == 'el' else 'las'
    else:
        art = d
    if meta['cls'].startswith('plural-only: the headword is not the plural'):
        problems.append(f'row {n} ({word}): the card\'s headword is not the plural form: choose без артикля or fix the headword first; skipped')
        continue
    decided[key] = ('set', f'{art} {head}', ARTICLE_G[art], word)

# ---- the result: the settled nouns of the rules + the decisions
entries = {r['key']: {'d': r['display'], 'g': r['g']} for r in full if r['status'] == 'agree'}
excluded = []
for key, (kind, display, g, word) in decided.items():
    if kind == 'set':
        entries[key] = {'d': display, 'g': g}
    else:
        excluded.append(word)
order = [r['key'] for r in full]

# ---- the owner's overrides (overrides.json): they win over the sheet and over the settled rules
overrides = {}
ov_path = os.path.join(here, 'overrides.json')
if os.path.exists(ov_path):
    with open(ov_path, encoding='utf-8') as f:
        overrides = json.load(f)
ov_lines = []
# a key the dictionary gained after the model pass (a rename, like gana -> ganas) is added to the order here
for key in overrides.get('set', {}):
    if key not in order:
        order.append(key)
for key, display in overrides.get('set', {}).items():
    m = DISPLAY.match(display)
    if key not in order or not m:
        problems.append(f'override set "{key}": "{display}" is not a known key or not article + word; ignored')
        continue
    before = entries.get(key, {}).get('d')
    entries[key] = {'d': display, 'g': ARTICLE_G[m.group(1)]}
    ov_lines.append(f'{key}: {before or "(no entry)"} → {display}')
    decided.pop(key, None)
for key in overrides.get('none', []):
    if key not in order:
        problems.append(f'override none "{key}": not a noun key; ignored')
        continue
    before = entries.pop(key, {}).get('d')
    word = next(r['word'] for r in full if r['key'] == key)
    if word not in excluded:
        excluded.append(word)
    ov_lines.append(f'{key}: {before or "(no entry)"} → no article')
    decided.pop(key, None)
new_entries = {k: entries[k] for k in order if k in entries}

# ---- what changed against the file as it is now
old = current['entries']
added = [k for k in new_entries if k not in old]
removed = [k for k in old if k not in new_entries]
changed = [k for k in new_entries if k in old and old[k] != new_entries[k]]
set_by_decision = [k for k, v in decided.items() if v[0] == 'set']
ov_keys = set(overrides.get('set', {})) | set(overrides.get('none', []))
agree_changed = [k for k in changed if k not in decided and k not in ov_keys]
removed_unexplained = [k for k in removed if k not in ov_keys]

lines = []
p = lines.append
p(f'# merge of {os.path.basename(args.sheet)}')
p('')
p(f'- sheet rows matched to the review set: {len(seen)} of {len(review_rows)}; decided: {sum(counts.values())}; not decided yet: {undecided}')
p('- decisions: ' + ', '.join(f'{k} {v}' for k, v in counts.items()))
p(f'- entries before: {len(old)}; after: {len(new_entries)}')
p(f'- added: {len(added)}; changed: {len(changed)}; removed: {len(removed)}')
p(f'- entries set by a decision: {len(set_by_decision)}; marked "без артикля" (no entry): {len(excluded)}')
if ov_lines:
    p(f'- overrides from overrides.json applied: {len(ov_lines)}')
if agree_changed or removed_unexplained:
    p(f'- NOTE: {len(agree_changed)} settled entries changed and {len(removed_unexplained)} were removed without a decision (the rules changed since the last write): ' + ', '.join(f'{k}' for k in (agree_changed + removed_unexplained)[:40]))
if problems:
    p('')
    p(f'## Skipped ({len(problems)})')
    for x in problems:
        p('- ' + x)
if ov_lines:
    p('')
    p('## Overrides (overrides.json, win over the sheet)')
    for x in ov_lines:
        p('- ' + x)
if added:
    p('')
    p('## Added')
    for k in added:
        p(f'- {k}: {new_entries[k]["d"]} ({new_entries[k]["g"]})')
if changed:
    p('')
    p('## Changed')
    for k in changed:
        p(f'- {k}: {old[k]["d"]} → {new_entries[k]["d"]}')
if excluded:
    p('')
    p('## No article (без артикля)')
    p(', '.join(excluded))
report = '\n'.join(lines) + '\n'
print(report)

if args.dry:
    print('(dry run: nothing written)')
    sys.exit(0)

stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
backup = f'noun_gender.before-merge-{stamp.replace(":", "")}.json'
shutil.copyfile(os.path.join(out, 'noun_gender.json'), os.path.join(out, backup))
result = {k: v for k, v in current.items() if k != 'entries'}
result['merged'] = {'sheet': os.path.basename(args.sheet), 'at': stamp, 'decisions': counts}
result['entries'] = new_entries
with open(os.path.join(out, 'noun_gender.json'), 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False)
with open(os.path.join(out, 'noun_gender.excluded.json'), 'w', encoding='utf-8') as f:
    json.dump(sorted(excluded), f, ensure_ascii=False, indent=1)
with open(os.path.join(out, 'merge-report.md'), 'w', encoding='utf-8') as f:
    f.write(report)
print(f'written: {os.path.join(out, "noun_gender.json")} (the old one kept as {backup}), merge-report.md, noun_gender.excluded.json')
