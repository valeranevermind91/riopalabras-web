"""The review sheet: only the REVIEW rows of the gender study, with an empty "Решение" column that has a dropdown.
Usage: python3 tools/gender/review-xlsx.py [output.xlsx]   (reads tools/gender/out/review-rows.json)"""
import json
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

here = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(os.path.join(here, 'out', 'review-rows.json'), encoding='utf-8'))
target = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Desktop/gender-review.xlsx')

wb = Workbook()
ws = wb.active
ws.title = 'REVIEW'
headers = ['Word (as displayed)', 'Our gloss (EN / RU)', 'Example', 'Article signal', 'Suffix', 'Model', 'Proposed display', 'Why it is here', 'Решение']
ws.append(headers)
for r in rows:
    ws.append([r['word'], r['gloss'], r['example'], r['article'], r['suffix'], r['model'], r['proposed'], r['why'], None])

widths = [24, 34, 52, 18, 20, 44, 20, 46, 16]
for i, w in enumerate(widths, start=1):
    ws.column_dimensions[chr(64 + i)].width = w
head_fill = PatternFill('solid', fgColor='DDE6F0')
for cell in ws[1]:
    cell.font = Font(bold=True)
    cell.fill = head_fill
    cell.alignment = Alignment(vertical='center', wrap_text=True)
decision_fill = PatternFill('solid', fgColor='FFF7D6')
for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
    for cell in row:
        cell.alignment = Alignment(vertical='top', wrap_text=True)
    row[0].font = Font(bold=True)
    row[8].fill = decision_fill
ws.freeze_panes = 'B2'
ws.auto_filter.ref = ws.dimensions

dv = DataValidation(type='list', formula1='"OK,el,la,el/la,без артикля"', allow_blank=True, showDropDown=False)
dv.errorTitle = 'Решение'
dv.error = 'Choose: OK, el, la, el/la, без артикля'
dv.showErrorMessage = True
ws.add_data_validation(dv)
dv.add(f'I2:I{max(ws.max_row, 2)}')

wb.save(target)
print(f'{len(rows)} REVIEW rows -> {target}')
